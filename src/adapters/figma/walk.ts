// breadth-first walker over a figma subtree. fetches the root via get_metadata
// and yields every descendant as a NormalizedFigmaNode for the audit pipeline

import type { NormalizedFigmaNode } from '../../audit/define-rule';

// walk request: file key, the root node to descend from, and an mcp client
export interface WalkOpts {
  fileKey: string;
  rootNodeId: string;
  figma: {
    getMetadata: (input: {
      fileKey: string;
      nodeId?: string;
    }) => Promise<unknown[]>;
  };
}

interface RawFigmaNode {
  id: string;
  name: string;
  type?: string;
  fills?: NormalizedFigmaNode['fills'];
  componentKey?: string | null;
  variantProperties?: Record<string, string>;
  overrides?: Record<string, unknown>;
  children?: RawFigmaNode[];
}

// validate the minimum shape (id + name) before treating a value as a node
function asRaw(value: unknown): RawFigmaNode {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`walkFigma: expected node object, got ${typeof value}`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['id'] !== 'string' || typeof obj['name'] !== 'string') {
    throw new Error('walkFigma: node missing id or name');
  }
  return obj as unknown as RawFigmaNode;
}

// project the raw mcp node into the canonical shape rules expect
function normalize(raw: RawFigmaNode, parentId?: string): NormalizedFigmaNode {
  const out: NormalizedFigmaNode = {
    id: raw.id,
    name: raw.name,
    type: raw.type ?? 'NODE',
    componentKey: raw.componentKey ?? null,
  };
  if (raw.fills !== undefined) out.fills = raw.fills;
  if (raw.variantProperties !== undefined)
    out.variantProperties = raw.variantProperties;
  if (raw.overrides !== undefined) out.overrides = raw.overrides;
  if (raw.children !== undefined)
    out.children = raw.children as NormalizedFigmaNode[];
  if (parentId !== undefined) out.parentId = parentId;
  return out;
}

// yield every node under rootNodeId in breadth-first order, parents first
export async function* walkFigma(
  opts: WalkOpts
): AsyncGenerator<NormalizedFigmaNode> {
  const roots = await opts.figma.getMetadata({
    fileKey: opts.fileKey,
    nodeId: opts.rootNodeId,
  });
  const stack: Array<{ node: RawFigmaNode; parentId?: string }> = [];
  for (const r of roots) stack.push({ node: asRaw(r) });

  while (stack.length > 0) {
    const item = stack.shift()!;
    const norm = normalize(item.node, item.parentId);
    yield norm;
    if (Array.isArray(item.node.children)) {
      for (const c of item.node.children)
        stack.push({ node: c, parentId: norm.id });
    }
  }
}
