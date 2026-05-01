// emitter registry. resolves emitter names from divebar.json into ready-to-run
// Emitter objects, looking up built-ins first and dynamically importing the
// rest as relative paths or module specifiers

import { defineEmitter, type Emitter } from './define-emitter';
import { renderTokens } from '../core/token-parser';

// built-in emitters keyed by the name users put in divebar.json. divebar's
// only ship-with-the-cli emitter; richer outputs live as plugins users
// author themselves and reference by relative path or module specifier
const BUILT_INS: Record<string, Emitter> = {
  '@divebar/emit-tokens-ts': defineEmitter({
    name: '@divebar/emit-tokens-ts',
    emit: ({ tokens, outDir }) => [
      { path: `${outDir}/tokens.ts`, contents: renderTokens(tokens) },
    ],
  }),
};

export const BUILTIN_EMITTER_NAMES = Object.keys(BUILT_INS);

// load request: workspace root for relative paths plus the configured names
export interface LoadEmittersOpts {
  root: string;
  names: string[];
}

// resolve names to Emitter objects in declaration order. unknown names that
// don't expose a default-exported emit() function throw immediately
export async function loadEmitters(opts: LoadEmittersOpts): Promise<Emitter[]> {
  const out: Emitter[] = [];
  for (const name of opts.names) {
    if (name in BUILT_INS) {
      out.push(BUILT_INS[name]!);
      continue;
    }
    const spec =
      name.startsWith('./') || name.startsWith('../')
        ? `${opts.root}/${name.replace(/^\.\//, '')}`
        : name;
    const mod = (await import(spec)) as { default?: Emitter };
    if (!mod.default || typeof mod.default.emit !== 'function') {
      throw new Error(
        `emitter "${name}" has no default export with an emit() function`
      );
    }
    out.push(mod.default);
  }
  return out;
}
