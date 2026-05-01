// audit rule registry. ships built-ins plus dynamically-imported user rules
// referenced by glob (relative paths) or module specifier (anything else)

import { glob } from 'glob';
import deprecatedVariants from './rules/deprecated-variants';
import hardcodedFills from './rules/hardcoded-fills';
import detachedInstances from './rules/detached-instances';
import nonLibraryInstances from './rules/non-library-instances';
import overrideSprawl from './rules/override-sprawl';
import type { AuditRule } from './define-rule';

// rules that always run; user-supplied rules are appended after these
const BUILT_INS: AuditRule[] = [
  deprecatedVariants,
  hardcodedFills,
  detachedInstances,
  nonLibraryInstances,
  overrideSprawl,
];

export const BUILTIN_RULE_NAMES = BUILT_INS.map((r) => r.name);

// load request: workspace root for relative globs, plus the configured patterns
export interface LoadRulesOpts {
  root: string;
  patterns: string[];
}

// resolve patterns to rule modules. relative patterns are scanned via glob;
// other strings are imported as module specifiers. each module must default-
// export a rule produced by defineRule
export async function loadRules(opts: LoadRulesOpts): Promise<AuditRule[]> {
  const out: AuditRule[] = [...BUILT_INS];
  for (const pattern of opts.patterns) {
    if (pattern.startsWith('./') || pattern.startsWith('../')) {
      const matches = await glob(pattern.replace(/^\.\//, ''), {
        cwd: opts.root,
        dot: true,
      });
      for (const rel of matches) {
        const mod = (await import(`${opts.root}/${rel}`)) as {
          default?: AuditRule;
        };
        if (mod.default && mod.default.name) out.push(mod.default);
      }
    } else {
      const mod = (await import(pattern)) as { default?: AuditRule };
      if (mod.default && mod.default.name) out.push(mod.default);
    }
  }
  return out;
}
