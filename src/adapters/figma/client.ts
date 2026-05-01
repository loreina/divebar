// typed figma-specific wrapper around the generic json-rpc mcp transport
// validates the mcp content envelope, unwraps the inner json payload,
// and surfaces friendly errors that name the offending tool

import { z } from 'zod';
import { startMcpClient } from './transport';
import type { McpClient, McpServerConfig } from './transport';

// every figma mcp tool wraps its real result in a content envelope; isError
// flags a soft failure that we lift into a thrown Error
const ContentEnvelopeSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string() })).min(1),
  isError: z.boolean().optional(),
});

// shape of a node returned by get_metadata (parent + immediate children)
const MetadataChildSchema = z.object({ id: z.string(), name: z.string() });
const MetadataNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  children: z.array(MetadataChildSchema).default([]),
});
const MetadataResponseSchema = z.array(MetadataNodeSchema);

// shape of a hit returned by search_design_system: nodeId paired with its key
const SearchHitSchema = z.object({ nodeId: z.string(), key: z.string() });
const SearchResponseSchema = z.array(SearchHitSchema);

// shape of a single variable definition returned by get_variable_defs
const VariableModeSchema = z.object({ modeId: z.string(), name: z.string() });
const VariableDefSchema = z.object({
  name: z.string(),
  resolvedType: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']),
  valuesByMode: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
});
const VariableDefsResponseSchema = z.object({
  modes: z.array(VariableModeSchema),
  variables: z.array(VariableDefSchema),
});

export type MetadataNode = z.infer<typeof MetadataNodeSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type VariableDefsResponse = z.infer<typeof VariableDefsResponseSchema>;

export interface GetMetadataInput {
  fileKey: string;
  nodeId?: string;
}

export interface GetVariableDefsInput {
  fileKey: string;
  modes?: string[];
}

export interface FigmaMcpClient {
  getDesignContext(url: string): Promise<unknown>;
  getContextForCodeConnect(url: string): Promise<unknown>;
  useFigma(script: string): Promise<unknown>;
  getMetadata(input: GetMetadataInput): Promise<MetadataNode[]>;
  searchDesignSystem(input: { fileKey: string }): Promise<SearchHit[]>;
  getVariableDefs(input: GetVariableDefsInput): Promise<VariableDefsResponse>;
  dispose(): Promise<void>;
}

// invoke any figma mcp tool that returns a json-text content envelope and
// return the parsed inner payload, throwing readable errors on shape misses
async function callJsonTool(
  client: McpClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const raw = await client.callTool(name, args);
  const parsed = ContentEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const path = i.path.join('.') || '<root>';
        return `${path}: ${i.message}`;
      })
      .join('; ');
    throw new Error(
      `Figma MCP tool '${name}' returned an unexpected envelope (${issues})`
    );
  }
  const first = parsed.data.content[0];
  if (!first) {
    throw new Error(`Figma MCP tool '${name}' returned an empty content array`);
  }
  const text = first.text;
  if (parsed.data.isError === true) {
    throw new Error(`Figma MCP tool '${name}' failed: ${text}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Figma MCP tool '${name}' returned non-JSON content: ${detail}`
    );
  }
}

// fetch the immediate metadata for a node (or the file root when nodeId is omitted)
async function getMetadata(
  client: McpClient,
  input: GetMetadataInput
): Promise<MetadataNode[]> {
  const args: Record<string, unknown> = { fileKey: input.fileKey };
  if (input.nodeId !== undefined) args['nodeId'] = input.nodeId;
  const raw = await client.callTool('get_metadata', args);
  return MetadataResponseSchema.parse(raw);
}

// list every published component set in the file and its key
async function searchDesignSystem(
  client: McpClient,
  input: { fileKey: string }
): Promise<SearchHit[]> {
  const raw = await client.callTool('search_design_system', {
    fileKey: input.fileKey,
  });
  return SearchResponseSchema.parse(raw);
}

// fetch every variable definition with its values per mode, optionally
// scoped to a subset of mode names
async function getVariableDefs(
  client: McpClient,
  input: GetVariableDefsInput
): Promise<VariableDefsResponse> {
  const args: Record<string, unknown> = { fileKey: input.fileKey };
  if (input.modes !== undefined) args['modes'] = input.modes;
  const raw = await client.callTool('get_variable_defs', args);
  return VariableDefsResponseSchema.parse(raw);
}

// project an open mcp client into the figma-specific surface
export function wrapFigmaMcp(client: McpClient): FigmaMcpClient {
  return {
    getDesignContext: (url) =>
      callJsonTool(client, 'get_design_context', { url }),
    getContextForCodeConnect: (url) =>
      callJsonTool(client, 'get_context_for_code_connect', { url }),
    useFigma: (script) => callJsonTool(client, 'use_figma', { script }),
    getMetadata: (input) => getMetadata(client, input),
    searchDesignSystem: (input) => searchDesignSystem(client, input),
    getVariableDefs: (input) => getVariableDefs(client, input),
    dispose: () => client.dispose(),
  };
}

// spawn a figma mcp server and immediately wrap it for typed access
export async function startFigmaMcp(
  cfg: McpServerConfig
): Promise<FigmaMcpClient> {
  return wrapFigmaMcp(await startMcpClient(cfg));
}
