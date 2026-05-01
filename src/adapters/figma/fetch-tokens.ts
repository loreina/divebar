// thin fetch layer for figma variable defs. shapes the raw mcp response into
// a flat manifest keyed by variable name and supports an optional cache

// raw response shape returned by the figma mcp get_variable_defs tool
export interface FigmaVariableDefsResponse {
  modes: Array<{ modeId: string; name: string }>;
  variables: Array<{
    name: string;
    resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
    valuesByMode: Record<string, string | number | boolean>;
  }>;
}

// flat manifest keyed by variable name; values keyed by figma modeId
export interface FigmaVariablesManifest {
  modes: Record<string, string>;
  variables: Record<
    string,
    {
      type: string;
      valuesByMode: Record<string, string | number | boolean>;
    }
  >;
}

// reshape the mcp response into the manifest used downstream
export function mcpVariableDefsToManifest(
  resp: FigmaVariableDefsResponse
): FigmaVariablesManifest {
  const modes: Record<string, string> = {};
  for (const m of resp.modes) modes[m.modeId] = m.name;

  const variables: FigmaVariablesManifest['variables'] = {};
  for (const v of resp.variables) {
    variables[v.name] = { type: v.resolvedType, valuesByMode: v.valuesByMode };
  }
  return { modes, variables };
}

// pluggable cache so callers can persist manifests across runs
export interface VariableCache {
  read: () => Promise<FigmaVariablesManifest | null>;
  write: (value: FigmaVariablesManifest) => Promise<void>;
}

// fetch request: file key, optional mode filter, mcp client, and optional cache
export interface FetchVariablesOpts {
  fileKey: string;
  modes?: string[];
  figma: {
    getVariableDefs: (input: {
      fileKey: string;
      modes?: string[];
    }) => Promise<FigmaVariableDefsResponse>;
  };
  cache?: VariableCache;
}

// hit the cache first, otherwise call the mcp and (when caching) write back
export async function fetchFigmaVariables(
  opts: FetchVariablesOpts
): Promise<FigmaVariablesManifest> {
  if (opts.cache) {
    const cached = await opts.cache.read();
    if (cached) return cached;
  }
  const resp = await opts.figma.getVariableDefs({
    fileKey: opts.fileKey,
    ...(opts.modes !== undefined ? { modes: opts.modes } : {}),
  });
  const manifest = mcpVariableDefsToManifest(resp);
  if (opts.cache) await opts.cache.write(manifest);
  return manifest;
}
