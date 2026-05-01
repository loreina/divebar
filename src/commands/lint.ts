// `divebar lint`: walk a component (or all components) for missing variant
// bindings, unknown variant keys, and token refs that don't resolve in the
// active token set. surfaces typos via levenshtein-suggested replacements

import { loadEffectiveRegistry } from '../core/registry';
import { ComponentDefinitionSchema } from '../core/schema';
import { enumerateVariants, matchedBindings } from '../core/variants';
import { parseTokensSpec } from '../core/token-parser';
import { safeJoin } from '../utils/safe-path';
import { readText, exists } from '../utils/io';
import type {
  ComponentDefinition,
  ExcludeRule,
  VariantSelector,
  TokenSet,
} from '../core/types';

// severity level for a lint finding
export type FindingSeverity = 'error' | 'warning';

// category tag for a lint finding
export type FindingKind =
  | 'missing-binding'
  | 'unknown-variant-key'
  | 'unknown-token'
  | 'excluded-undefined'
  | 'empty-bindings';

// single lint finding with context for reporting
export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  message: string;
  combo?: VariantSelector;
  prop?: string;
  ref?: string;
  suggestion?: string;
}

// aggregated lint output for one component
export interface LintReport {
  name: string;
  findings: Finding[];
}

// lint one component by name, or all components when name is omitted
export async function runLint(
  name?: string,
  root = process.cwd(),
  workspace?: string,
  verbose = false
): Promise<LintReport[]> {
  const hint = name
    ? { name, workspace }
    : workspace
      ? { workspace }
      : undefined;
  const reg = await loadEffectiveRegistry(root, hint);
  const tokens = await loadTokens(reg.root, reg.tokensPath, reg.tokensJsonPath);

  const entries = name
    ? [[name, reg.components[name]] as const]
    : Object.entries(reg.components);

  if (name && !reg.components[name])
    throw new Error(`unknown component "${name}"`);

  const reports: LintReport[] = [];

  for (const [, entry] of entries) {
    const irText = await readText(safeJoin(reg.root, entry!.irPath));
    const ir = ComponentDefinitionSchema.parse(
      JSON.parse(irText)
    ) as unknown as ComponentDefinition;
    reports.push(lintIR(ir, tokens, verbose));
  }

  return reports;
}

// run all lint checks against a parsed ir and token set
export function lintIR(
  ir: ComponentDefinition,
  tokens: TokenSet,
  verbose = false
): LintReport {
  const findings: Finding[] = [];

  checkUnknownVariantKeys(ir, findings);
  checkEmptyBindings(ir, findings);
  checkMissingBindings(ir, findings, verbose);
  checkTokenRefs(ir, tokens, findings);

  return { name: ir.name, findings };
}

// warn when no style rule has any bindings (commonly a half-built bootstrap seed)
function checkEmptyBindings(ir: ComponentDefinition, findings: Finding[]) {
  const hasAnyBinding = ir.styles.some(
    (rule) => Object.keys(rule.bindings).length > 0
  );
  if (!hasAnyBinding) {
    findings.push({
      kind: 'empty-bindings',
      severity: 'warning',
      message: 'component has no style bindings — did you forget to fill them in?',
    });
  }
}

// flag style rules that reference variant keys not declared in ir.variants
function checkUnknownVariantKeys(ir: ComponentDefinition, findings: Finding[]) {
  const validKeys = new Set(Object.keys(ir.variants));

  for (const rule of ir.styles) {
    for (const key of Object.keys(rule.when)) {
      if (!validKeys.has(key)) {
        findings.push({
          kind: 'unknown-variant-key',
          severity: 'error',
          message: `style rule references unknown variant key "${key}" (valid: ${Array.from(validKeys).join(', ')})`,
        });
      }
    }
  }
}

// detect variant combos that lack a binding for a style prop
// groups by prop in default mode; expands per-combo in verbose mode
function checkMissingBindings(
  ir: ComponentDefinition,
  findings: Finding[],
  verbose: boolean
) {
  const allCombos = enumerateVariants(ir.variants);
  const excluded = ir.excludeWhen ?? [];
  const includedCombos = allCombos.filter(
    (c) => !matchesAnyExclusion(c, excluded)
  );

  const allBindingProps = new Set(
    ir.styles.flatMap((r) => Object.keys(r.bindings))
  );
  const missingByProp = new Map<string, VariantSelector[]>();

  for (const combo of includedCombos) {
    const matched = matchedBindings(ir, combo);
    for (const prop of allBindingProps) {
      if (!(prop in matched)) {
        if (!missingByProp.has(prop)) missingByProp.set(prop, []);
        missingByProp.get(prop)!.push(combo);
      }
    }
  }

  for (const [prop, combos] of missingByProp) {
    if (verbose) {
      for (const combo of combos) {
        findings.push({
          kind: 'missing-binding',
          severity: 'warning',
          message: `variant combination missing "${prop}" binding`,
          combo,
          prop,
        });
      }
    } else {
      const total = includedCombos.length;
      const samples = combos
        .slice(0, 3)
        .map((c) => JSON.stringify(c))
        .join(', ');

      findings.push({
        kind: 'missing-binding',
        severity: 'warning',
        message: `${combos.length} of ${total} variant combinations missing "${prop}" binding (e.g. ${samples})`,
        prop,
      });
    }
  }
}

// flag token references in bindings that don't exist in the token set
function checkTokenRefs(
  ir: ComponentDefinition,
  tokens: TokenSet,
  findings: Finding[]
) {
  const flatKeys = flattenTokenKeys(tokens.tokens);

  for (const rule of ir.styles) {
    for (const [, ref] of Object.entries(rule.bindings)) {
      if (!tokenExists(flatKeys, ref!)) {
        const suggestion = closestMatch(ref!, flatKeys);

        findings.push({
          kind: 'unknown-token',
          severity: 'error',
          message: `unknown token reference "${ref}"${suggestion ? ` (did you mean "${suggestion}"?)` : ''}`,
          ref: ref!,
          suggestion,
        });
      }
    }
  }
}

// recursively collect all dot-separated token paths from a nested token object
function flattenTokenKeys(tokens: any, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [k, v] of Object.entries(tokens)) {
    const path = prefix ? `${prefix}.${k}` : k;

    if (v && typeof v === 'object' && '$type' in (v as any)) {
      keys.push(path);
    } else if (v && typeof v === 'object') {
      keys.push(...flattenTokenKeys(v, path));
    }
  }

  return keys;
}

// check whether a token ref is present in the flat key list
function tokenExists(flatKeys: string[], ref: string): boolean {
  return flatKeys.includes(ref);
}

// find the nearest token name within levenshtein threshold for typo suggestions
function closestMatch(ref: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;

  for (const c of candidates) {
    const d = levenshtein(ref, c);
    if (d < bestDist && d <= Math.max(3, ref.length * 0.4)) {
      bestDist = d;
      best = c;
    }
  }

  return best;
}

// standard levenshtein edit distance between two strings
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }

  return dp[m]![n]!;
}

// true if the selector matches any rule in the exclusion list
function matchesAnyExclusion(
  sel: VariantSelector,
  rules: ExcludeRule[]
): boolean {
  return rules.some((rule) => matchesExclusion(sel, rule));
}

// true if every constraint in the rule is satisfied by the selector
function matchesExclusion(sel: VariantSelector, rule: ExcludeRule): boolean {
  for (const [key, constraint] of Object.entries(rule)) {
    const val = sel[key];
    if (val === undefined) return false;

    if (typeof constraint === 'boolean') {
      if (constraint && val !== true && val !== 'true') return false;
      if (!constraint && (val === true || val === 'true')) return false;
    } else if (Array.isArray(constraint)) {
      if (!constraint.includes(String(val))) return false;
    } else {
      if (String(val) !== constraint) return false;
    }
  }

  return true;
}

// load the token set from the spec sidecar, falling back to empty
async function loadTokens(
  root: string,
  tokensPath: string,
  tokensJsonPath?: string
): Promise<TokenSet> {
  const specPath = tokensJsonPath
    ? safeJoin(root, tokensJsonPath)
    : safeJoin(root, tokensPath).replace(/\.ts$/, '.divebar.json');

  if (await exists(specPath)) {
    return parseTokensSpec(await readText(specPath));
  }

  return { tokens: {} };
}
