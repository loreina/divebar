// figma adapter: produces use_figma plugin api scripts that recreate a
// component (or push token variables) from the canonical ir

import type { FigmaConfig, FigmaScriptAdapter } from './types';
import type {
  ComponentDefinition,
  ExcludeRule,
  TokenSet,
  VariantSelector,
} from '../core/types';
import { enumerateVariants, matchedBindings } from '../core/variants';

// convert a dot-path token ref to a figma variable path using the given separator
export function tokenRefToVariablePath(ref: string, separator = '/'): string {
  return ref.replaceAll('.', separator);
}

// walk the token tree by dot-path ref and return the token's designName if present
// returns undefined when the ref doesn't resolve to a leaf token or has no designName
export function findTokenDesignName(
  tokens: TokenSet,
  ref: string
): string | undefined {
  const parts = ref.split('.');
  let node: any = tokens.tokens;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[p];
  }
  if (
    node &&
    typeof node === 'object' &&
    typeof node.designName === 'string'
  ) {
    return node.designName;
  }
  return undefined;
}

// resolve a token ref to a figma variable path
// order: token.designName -> dot-path with registry separator -> default '/'
function resolveVariablePath(
  tokens: TokenSet,
  ref: string,
  config?: FigmaConfig
): string {
  const designName = findTokenDesignName(tokens, ref);
  if (designName) return designName;

  const separator = config?.tokenPathSeparator ?? '/';
  return tokenRefToVariablePath(ref, separator);
}

// generates figma plugin api scripts from ir
export const figmaAdapter: FigmaScriptAdapter = {
  renderComponent(ir, tokens, config) {
    const allCombos = enumerateVariants(ir.variants);
    const combos = ir.excludeWhen
      ? allCombos.filter((sel) => !matchesAnyExclusion(sel, ir.excludeWhen!))
      : allCombos;

    const variableBindings: Record<string, Record<string, string>> = {};

    const variants = combos.map((sel) => {
      const styles = matchedBindings(ir, sel);
      const variantName = toDesignVariantName(sel, ir.variantMappings);

      const bindings: Record<string, string> = {};
      for (const [prop, ref] of Object.entries(styles)) {
        bindings[prop] = resolveVariablePath(tokens, ref, config);
      }
      if (Object.keys(bindings).length > 0) {
        variableBindings[variantName] = bindings;
      }

      return { name: variantName };
    });

    const ds = ir.designSource;
    const name = JSON.stringify(ir.name);
    const args: string[] = [`name: ${name}`];
    if (ds?.fileKey) args.push(`fileKey: ${JSON.stringify(ds.fileKey)}`);
    if (ds?.nodeId) args.push(`nodeId: ${JSON.stringify(ds.nodeId)}`);
    if (ds?.componentKey)
      args.push(`componentKey: ${JSON.stringify(ds.componentKey)}`);
    args.push('variants');
    args.push('variableBindings');

    const nodeLabel = ds?.nodeId ?? 'unknown';

    return [
      `// divebar: generated component "${ir.name}" (node ${nodeLabel})`,
      `const variants = ${JSON.stringify(variants, null, 2)};`,
      `const variableBindings = ${JSON.stringify(variableBindings, null, 2)};`,
      `await figma.createComponent({ ${args.join(', ')} });`,
    ].join('\n');
  },

  renderTokens(tokens, _config) {
    const body = JSON.stringify(tokens.tokens, null, 2);
    return [
      `// divebar: generated variables`,
      `await figma.upsertVariables(${body});`,
    ].join('\n');
  },
};

// build a figma-style variant name like "Kind=Primary, Size=Large" using
// design mappings; falls back to the code-side keys when no mapping exists
function toDesignVariantName(
  sel: VariantSelector,
  mappings?: Record<
    string,
    {
      designName: string;
      values: { code: string | boolean; designName: string }[];
    }
  >
): string {
  return Object.entries(sel)
    .map(([k, v]) => {
      const mapping = mappings?.[k];
      if (mapping) {
        const propName = mapping.designName;
        const valMapping = mapping.values.find(
          (vm) => String(vm.code) === String(v)
        );
        const valName = valMapping?.designName ?? String(v);
        return `${propName}=${valName}`;
      }
      return `${k}=${v}`;
    })
    .join(', ');
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
      if (constraint && val !== 'true' && val !== 'Yes') return false;
      if (!constraint && (val === 'true' || val === 'Yes')) return false;
    } else if (Array.isArray(constraint)) {
      if (!constraint.includes(String(val))) return false;
    } else {
      if (val !== constraint) return false;
    }
  }

  return true;
}
