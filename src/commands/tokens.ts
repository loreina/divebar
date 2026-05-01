// `divebar tokens` subcommands: pull (json or url), push, import. each one
// either writes a tokens.ts + sidecar pair or runs the configured emitter
// pipeline; the figma mcp is spawned only when needed

import { z } from 'zod';
import { TokenSetSchema } from '../core/schema';
import type { TokenSet, ModeInfo } from '../core/types';
import {
  renderTokens,
  renderTokensSpec,
  parseTokensSpec,
} from '../core/token-parser';
import { loadEffectiveRegistry, readRegistry } from '../core/registry';
import { figmaAdapter } from '../adapters/figma';
import { startFigmaMcp } from '../adapters/figma/client';
import type { FigmaMcpClient } from '../adapters/figma/client';
import {
  fetchFigmaVariables,
  type FigmaVariableDefsResponse,
  type FigmaVariablesManifest as McpVariablesManifest,
  type VariableCache,
} from '../adapters/figma/fetch-tokens';
import { cacheKey, readCache, writeCache } from '../core/cache';
import { safeJoin } from '../utils/safe-path';
import { loadEmitters } from '../emit/registry';
import { readText, writeText, exists } from '../utils/io';
import { normalizeTokenRef } from '../utils/normalize';

// supported normalization strategies for figma variable names
export type TokenNameFormat = 'preserve' | 'camel' | 'dot';

interface NormalizeOpts {
  nameFormat?: TokenNameFormat;
  namePrefix?: string;
}

// apply optional prefix + normalization to a raw figma variable name
function applyNameFormat(name: string, opts: NormalizeOpts): string {
  const prefixed = opts.namePrefix ? `${opts.namePrefix}/${name}` : name;
  switch (opts.nameFormat ?? 'preserve') {
    case 'camel':
      return normalizeTokenRef(prefixed);
    case 'dot':
      return prefixed.replace(/[/\-]/g, '.');
    case 'preserve':
    default:
      return prefixed;
  }
}

// parse a token-set json blob and write both the runtime tokens.ts and the
// spec sidecar so the lint/sync pipeline has a parseable source of truth
export async function tokensPull(
  jsonInput: string,
  root = process.cwd(),
  workspace?: string
): Promise<void> {
  const ts = TokenSetSchema.parse(JSON.parse(jsonInput)) as unknown as TokenSet;
  const reg = await loadEffectiveRegistry(
    root,
    workspace ? { workspace } : undefined
  );

  const tokensPath = safeJoin(reg.root, reg.tokensPath);
  await writeText(tokensPath, renderTokens(ts));

  const specPath = reg.tokensJsonPath
    ? safeJoin(reg.root, reg.tokensJsonPath)
    : tokensPath.replace(/\.ts$/, '.divebar.json');
  await writeText(specPath, renderTokensSpec(ts));
}

// render the registry's token sidecar as a use_figma upsertVariables script
export async function tokensPush(
  root = process.cwd(),
  workspace?: string
): Promise<string> {
  const reg = await loadEffectiveRegistry(
    root,
    workspace ? { workspace } : undefined
  );
  const ts = await loadTokens(reg.root, reg.tokensPath, reg.tokensJsonPath);
  return figmaAdapter.renderTokens(ts, reg.figma);
}

export interface TokensImportOpts {
  from: 'figma' | 'dtcg' | 'style-dictionary';
  file?: string;
  fileKey?: string;
  modes?: string[];
  figma?: {
    getVariableDefs: (input: {
      fileKey: string;
      modes?: string[];
    }) => Promise<FigmaVariableDefsResponse>;
  };
  cachePath?: string;
  root?: string;
  workspace?: string;
  nameFormat?: TokenNameFormat;
  namePrefix?: string;
}

// import tokens from any supported source (figma mcp or a raw dtcg /
// style-dictionary file). when emitters are configured, runs the pipeline;
// otherwise writes the legacy tokens.ts + sidecar pair
export async function tokensImport(opts: TokensImportOpts): Promise<TokenSet> {
  const root = opts.root ?? process.cwd();

  const reg = await loadEffectiveRegistry(
    root,
    opts.workspace ? { workspace: opts.workspace } : undefined
  );

  const cfgFormat = reg.tokens?.nameFormat;
  const cfgPrefix = reg.tokens?.namePrefix;
  const normOpts: NormalizeOpts = {
    nameFormat: opts.nameFormat ?? cfgFormat ?? 'preserve',
    ...(opts.namePrefix !== undefined
      ? { namePrefix: opts.namePrefix }
      : cfgPrefix !== undefined
        ? { namePrefix: cfgPrefix }
        : {}),
  };

  let ts: TokenSet;

  if (opts.from === 'figma') {
    const fileKey = opts.fileKey;
    if (!fileKey) throw new Error('--file <key> required for --from figma');
    if (!opts.figma) throw new Error('figma client required for --from figma');
    const modes = opts.modes ?? [];
    const cachePath = opts.cachePath;
    const cache: VariableCache | undefined = cachePath
      ? {
          read: async () => {
            const k = await cacheKey({ fileKey, modes });
            return readCache<McpVariablesManifest>(cachePath, k);
          },
          write: async (v: McpVariablesManifest) => {
            const k = await cacheKey({ fileKey, modes });
            await writeCache(cachePath, k, v);
          },
        }
      : undefined;
    const manifest = await fetchFigmaVariables({
      fileKey,
      modes,
      figma: opts.figma,
      ...(cache !== undefined ? { cache } : {}),
    });
    ts = figmaVariablesToTokenSet(manifest, normOpts);
  } else {
    if (!opts.file) {
      throw new Error('--from ' + opts.from + ' requires <file>');
    }
    const raw = JSON.parse(await readText(opts.file));
    ts = TokenSetSchema.parse(raw) as unknown as TokenSet;
  }

  const emitterNames = reg.tokens?.emitters ?? [];
  if (emitterNames.length > 0) {
    const outDir = reg.tokens?.outDir
      ? safeJoin(reg.root, reg.tokens.outDir)
      : safeJoin(reg.root, 'src');
    const emitters = await loadEmitters({
      root: reg.root,
      names: emitterNames,
    });
    for (const emitter of emitters) {
      const files = await emitter.emit({
        tokens: ts,
        modes: ts.modes ?? [],
        outDir,
      });
      for (const f of files) {
        await writeText(f.path, f.contents);
      }
    }
  } else {
    const tokensPath = safeJoin(reg.root, reg.tokensPath);
    const specPath = reg.tokensJsonPath
      ? safeJoin(reg.root, reg.tokensJsonPath)
      : tokensPath.replace(/\.ts$/, '.divebar.json');
    await writeText(specPath, renderTokensSpec(ts));
    await writeText(tokensPath, renderTokens(ts));
  }
  return ts;
}

// load the spec sidecar, falling back to an empty token set when missing
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

// shape of a figma-variables fixture; matches what use_figma scripts return
interface FigmaVariablesManifest {
  fileKey?: string;
  collection?: string;
  modes: Record<string, string>;
  variables: Record<
    string,
    { type: string; valuesByMode: Record<string, any> }
  >;
}

// figma's resolvedType -> dtcg $type (booleans flatten to string for now)
const FIGMA_TYPE_MAP: Record<string, string> = {
  COLOR: 'color',
  FLOAT: 'number',
  STRING: 'string',
  BOOLEAN: 'string',
};

// derive a safe, stable folder name from a figma mode display name
// camelCases the input and de-collides duplicates with a numeric suffix
export function modeFolderName(name: string, used: Set<string>): string {
  const base = normalizeTokenRef(name.replace(/\s+/g, '-')) || 'mode';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base}${i++}`;
  }
  used.add(candidate);
  return candidate;
}

// translate a figma-variables manifest into a dtcg-shaped TokenSet,
// optionally normalizing variable names and applying a prefix; populates
// ModeInfo[] so emitters can write to friendly folder names
function figmaVariablesToTokenSet(
  manifest: FigmaVariablesManifest,
  opts: NormalizeOpts = {}
): TokenSet {
  const used = new Set<string>();
  const modes: ModeInfo[] = Object.entries(manifest.modes).map(
    ([id, name]) => ({ id, name, folder: modeFolderName(name, used) })
  );
  const tokens: Record<string, any> = {};
  for (const [name, v] of Object.entries(manifest.variables)) {
    const finalName = applyNameFormat(name, opts);
    tokens[finalName] = {
      $type: FIGMA_TYPE_MAP[v.type] ?? 'string',
      $valuesByMode: v.valuesByMode,
      designName: name,
    };
  }
  return { modes, defaultMode: modes[0]?.id, tokens };
}

// use_figma script run inside the figma plugin context to dump every local
// variable + mode into a manifest the cli can consume
export const FIGMA_VARIABLES_SCRIPT = `
const collections = figma.variables.getLocalVariableCollections();
const modes = {};
for (const c of collections) {
  for (const m of c.modes) {
    modes[m.modeId] = m.name;
  }
}
const variables = figma.variables.getLocalVariables().reduce((acc, v) => {
  acc[v.name] = { type: v.resolvedType, valuesByMode: v.valuesByMode };
  return acc;
}, {});
return {
  fileKey: figma.fileKey || '',
  collection: collections[0] && collections[0].name || 'main',
  modes,
  variables,
};
`.trim();

// schema used to validate the script's return shape before consuming it
const FigmaVariablesPayloadSchema = z.object({
  fileKey: z.string().optional(),
  collection: z.string().optional(),
  modes: z.record(z.string(), z.string()),
  variables: z.record(
    z.string(),
    z.object({
      type: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']),
      valuesByMode: z.record(z.string(), z.unknown()),
    })
  ),
});

export interface TokensPullFlags {
  workspace?: string;
  // progress sink; defaults to console.log
  log?: (msg: string) => void;
}

export interface TokensPullFromUrlOutcome {
  tokenSet: TokenSet;
  tokensPath: string;
  specPath: string;
  modeCount: number;
  variableCount: number;
}

// pure orchestrator. runs the figma-variables script in the active file,
// validates its payload, and writes both the tokens.ts and spec sidecar
export async function tokensPullFromUrlCore(opts: {
  url: string;
  root: string;
  flags: TokensPullFlags;
  figma: FigmaMcpClient;
}): Promise<TokensPullFromUrlOutcome> {
  const log = opts.flags.log ?? ((m: string) => console.log(m));

  // useFigma runs against the currently-active Figma file; the url argument is reserved for future scoping
  const raw = await opts.figma.useFigma(FIGMA_VARIABLES_SCRIPT);
  void opts.url;

  const parsed = FigmaVariablesPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const path = i.path.join('.') || '<root>';
        return `${path}: ${i.message}`;
      })
      .join('; ');
    throw new Error(
      `Figma variables payload did not match expected shape: ${issues}`
    );
  }

  const tokenSet = figmaVariablesToTokenSet(parsed.data);

  const reg = await loadEffectiveRegistry(
    opts.root,
    opts.flags.workspace ? { workspace: opts.flags.workspace } : undefined
  );

  const tokensAbs = safeJoin(reg.root, reg.tokensPath);
  await writeText(tokensAbs, renderTokens(tokenSet));

  const tokensRel = reg.tokensPath;
  const specRel = reg.tokensJsonPath
    ? reg.tokensJsonPath
    : tokensRel.replace(/\.ts$/, '.divebar.json');
  const specAbs = reg.tokensJsonPath
    ? safeJoin(reg.root, reg.tokensJsonPath)
    : tokensAbs.replace(/\.ts$/, '.divebar.json');
  await writeText(specAbs, renderTokensSpec(tokenSet));

  const variableCount = Object.keys(parsed.data.variables).length;
  const modeCount = Object.keys(parsed.data.modes).length;

  log(`✓ Pulled ${variableCount} variables across ${modeCount} modes`);

  return {
    tokenSet,
    tokensPath: tokensRel,
    specPath: specRel,
    modeCount,
    variableCount,
  };
}

// production entry. spawns the figma mcp from divebar.json and disposes after
export async function tokensPullFromUrl(
  url: string,
  flags: TokensPullFlags
): Promise<TokensPullFromUrlOutcome> {
  const root = process.cwd();
  const reg = await readRegistry(root);
  const figmaCfg = reg.mcp?.['figma'];
  if (!figmaCfg) {
    throw new Error(
      'divebar.json has no mcp.figma config; run `divebar init` first.'
    );
  }
  const figma = await startFigmaMcp(figmaCfg);
  try {
    return await tokensPullFromUrlCore({ url, root, flags, figma });
  } finally {
    try {
      await figma.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}
