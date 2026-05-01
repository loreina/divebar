// divebar.json schema + helpers. owns the project-level config that every
// command consumes: framework/styling defaults, output paths, registered
// components, optional workspaces[] for monorepos, and mcp server entries

import { z } from 'zod';
import { readJson, writeJson, exists } from '../utils/io';

// theme hook + import path for runtime theming
const ThemeConfigSchema = z.object({
  hook: z.string(),
  import: z.string(),
});

// project-level figma adapter config
const FigmaConfigSchema = z.object({
  tokenPathSeparator: z.string().default('/'),
});

// audit config: list of glob patterns or module specifiers for user rules
const AuditConfigSchema = z.object({
  rules: z.array(z.string()).default([]),
});

// tokens config: emitter pipeline + output directory
// precedence: when emitters[] is non-empty, outDir wins over the legacy
// tokensPath/tokensJsonPath; when emitters[] is empty, the legacy path is used
const TokensConfigSchema = z.object({
  input: z.string().optional(),
  emitters: z.array(z.string()).default([]),
  outDir: z.string().optional(),
  nameFormat: z.enum(['preserve', 'camel', 'dot']).default('preserve'),
  namePrefix: z.string().optional(),
});

// stdio MCP server entry; structurally matches McpServerConfig in transport.ts
const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// a single component entry in the registry
const Entry = z.object({
  irPath: z.string(),
  framework: z.enum(['react', 'react-native']).optional(),
  styling: z.enum(['tailwind', 'styled-components', 'stylesheet']).optional(),
  lastSynced: z.string().optional(),
});

// a workspace scope within a monorepo registry
const WorkspaceSchema = z.object({
  root: z.string(),
  framework: z.enum(['react', 'react-native']).default('react'),
  styling: z
    .enum(['tailwind', 'styled-components', 'stylesheet'])
    .default('styled-components'),
  outputDir: z.string().default('src/components'),
  tokensPath: z.string().default('src/tokens.ts'),
  tokensJsonPath: z.string().optional(),
  theme: ThemeConfigSchema.optional(),
  figma: FigmaConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  tokens: TokensConfigSchema.optional(),
  components: z.record(z.string(), Entry).default({}),
});

// top-level divebar.json structure
const RegistrySchema = z.object({
  version: z.literal('1').default('1'),
  framework: z.enum(['react', 'react-native']).default('react'),
  styling: z
    .enum(['tailwind', 'styled-components', 'stylesheet'])
    .default('styled-components'),
  outputDir: z.string().default('src/components'),
  tokensPath: z.string().default('src/tokens.ts'),
  tokensJsonPath: z.string().optional(),
  figmaFileKey: z.string().optional(),
  theme: ThemeConfigSchema.optional(),
  figma: FigmaConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  tokens: TokensConfigSchema.optional(),
  components: z.record(z.string(), Entry).default({}),
  workspaces: z.array(WorkspaceSchema).optional(),
  mcp: z.record(z.string(), McpServerConfigSchema).optional(),
});

export { RegistrySchema };

export type Registry = z.infer<typeof RegistrySchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type RegistryEntry = z.infer<typeof Entry> & { name: string };
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;
export type FigmaConfig = z.infer<typeof FigmaConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type TokensConfig = z.infer<typeof TokensConfigSchema>;

// resolved registry for a single workspace (or the root if no workspaces)
export interface EffectiveRegistry {
  root: string;
  framework: string;
  styling: string;
  outputDir: string;
  tokensPath: string;
  tokensJsonPath?: string;
  theme?: ThemeConfig;
  figma?: FigmaConfig;
  audit?: { rules: string[] };
  tokens?: {
    input?: string;
    emitters: string[];
    outDir?: string;
    nameFormat: 'preserve' | 'camel' | 'dot';
    namePrefix?: string;
  };
  components: Record<string, z.infer<typeof Entry>>;
}

const FILE = 'divebar.json';

// load divebar.json from root, returning defaults if missing
export async function readRegistry(root: string): Promise<Registry> {
  const path = `${root}/${FILE}`;
  if (!(await exists(path))) return RegistrySchema.parse({});
  return RegistrySchema.parse(await readJson(path));
}

// write the registry to divebar.json
export async function writeRegistry(
  root: string,
  reg: Registry
): Promise<void> {
  await writeJson(`${root}/${FILE}`, reg);
}

// return a new registry with the entry added to top-level components
export async function addEntry(
  reg: Registry,
  e: RegistryEntry
): Promise<Registry> {
  return {
    ...reg,
    components: {
      ...reg.components,
      [e.name]: {
        irPath: e.irPath,
        framework: e.framework,
        styling: e.styling,
        lastSynced: e.lastSynced,
      },
    },
  };
}

// return a new registry with the named component removed
export function removeEntry(reg: Registry, name: string): Registry {
  const { [name]: _, ...rest } = reg.components;
  return { ...reg, components: rest };
}

// resolve framework+styling for a component, falling back to registry defaults
export function resolveTarget(
  reg: EffectiveRegistry | Registry,
  name: string
): { framework: string; styling: string } {
  const entry = reg.components[name];
  return {
    framework: entry?.framework ?? reg.framework,
    styling: entry?.styling ?? reg.styling,
  };
}

// hints for resolving which workspace a command targets
export interface WorkspaceHint {
  workspace?: string;
  codePath?: string;
  name?: string;
}

// load the registry and resolve to a single effective workspace
export async function loadEffectiveRegistry(
  root: string,
  hint?: WorkspaceHint
): Promise<EffectiveRegistry> {
  const raw = await readRegistry(root);

  if (!raw.workspaces || raw.workspaces.length === 0) {
    return {
      root,
      framework: raw.framework,
      styling: raw.styling,
      outputDir: raw.outputDir,
      tokensPath: raw.tokensPath,
      tokensJsonPath: raw.tokensJsonPath,
      theme: raw.theme,
      figma: raw.figma,
      audit: raw.audit,
      tokens: raw.tokens,
      components: raw.components,
    };
  }

  const ws = pickWorkspace(raw.workspaces, hint);

  return {
    root: `${root}/${ws.root}`,
    framework: ws.framework,
    styling: ws.styling,
    outputDir: ws.outputDir,
    tokensPath: ws.tokensPath,
    tokensJsonPath: ws.tokensJsonPath,
    theme: ws.theme,
    figma: ws.figma ?? raw.figma,
    audit: ws.audit ?? raw.audit,
    tokens: ws.tokens ?? raw.tokens,
    components: ws.components,
  };
}

// match a workspace using explicit flag, code path prefix, or component name
function pickWorkspace(
  workspaces: Workspace[],
  hint?: WorkspaceHint
): Workspace {
  if (hint?.workspace) {
    const found = workspaces.find((ws) => ws.root === hint.workspace);
    if (!found) {
      const available = workspaces.map((ws) => ws.root).join(', ');
      throw new Error(
        `workspace "${hint.workspace}" not found; available: ${available}`
      );
    }
    return found;
  }

  if (hint?.codePath) {
    const matching = workspaces.filter((ws) =>
      hint.codePath!.startsWith(ws.root)
    );
    if (matching.length === 1) return matching[0]!;
    if (matching.length > 1) {
      throw new Error(
        `ambiguous workspace for "${hint.codePath}"; matches: ${matching.map((ws) => ws.root).join(', ')}. Use --workspace to disambiguate.`
      );
    }
  }

  if (hint?.name) {
    const matching = workspaces.filter((ws) => ws.components[hint.name!]);
    if (matching.length === 1) return matching[0]!;
    if (matching.length > 1) {
      throw new Error(
        `component "${hint.name}" found in multiple workspaces: ${matching.map((ws) => ws.root).join(', ')}. Use --workspace to disambiguate.`
      );
    }
  }

  throw new Error(
    `cannot determine workspace. Use --workspace <path> to specify. Available: ${workspaces.map((ws) => ws.root).join(', ')}`
  );
}

// add or update a component entry in a specific workspace
export async function addEntryToWorkspace(
  root: string,
  workspaceRoot: string,
  e: RegistryEntry
): Promise<void> {
  const raw = await readRegistry(root);

  if (!raw.workspaces) {
    await writeRegistry(root, await addEntry(raw, e));
    return;
  }

  const wsIdx = raw.workspaces.findIndex((ws) => ws.root === workspaceRoot);
  if (wsIdx === -1) throw new Error(`workspace "${workspaceRoot}" not found`);

  raw.workspaces[wsIdx]!.components[e.name] = {
    irPath: e.irPath,
    framework: e.framework,
    styling: e.styling,
    lastSynced: e.lastSynced,
  };

  await writeRegistry(root, raw);
}
