// `divebar mirror`: snapshot every published component set in a figma file
// to disk so other commands (audit, sync) can compare against a known state

import { buildVariantProperties } from '../adapters/figma/variants';
import {
  MirrorSchema,
  type Mirror,
  type MirrorEntry,
} from '../core/mirror-schema';
import { writeJson } from '../utils/io';

// minimum surface from the figma mcp the mirror commands need
export interface FigmaMirrorClient {
  getMetadata(input: { fileKey: string; nodeId?: string }): Promise<
    Array<{
      id: string;
      name: string;
      children: Array<{ id: string; name: string }>;
    }>
  >;
  searchDesignSystem(input: {
    fileKey: string;
  }): Promise<Array<{ nodeId: string; key: string }>>;
}

export interface MirrorSyncOpts {
  fileKey: string;
  figma: FigmaMirrorClient;
}

// fetch every component set + its component key, then build a deterministic
// Mirror by zipping the two sources by nodeId
export async function mirrorSync(opts: MirrorSyncOpts): Promise<Mirror> {
  const sets = await opts.figma.getMetadata({ fileKey: opts.fileKey });
  const keys = await opts.figma.searchDesignSystem({ fileKey: opts.fileKey });
  const keyByNode = new Map(keys.map((k) => [k.nodeId, k.key] as const));

  const mirror = sets.map((set) => ({
    name: set.name,
    nodeId: set.id,
    componentKey: keyByNode.get(set.id) ?? null,
    variantProperties: buildVariantProperties(set.children),
    children: set.children.map((c) => ({ name: c.name, nodeId: c.id })),
  }));

  return MirrorSchema.parse(mirror);
}

export interface WriteMirrorOpts {
  output: string;
  mirror: Mirror;
}

// write the entire mirror as one json file
export async function writeMirror(opts: WriteMirrorOpts): Promise<void> {
  await writeJson(opts.output, opts.mirror);
}

export interface WritePerComponentOpts {
  outputDir: string;
  mirror: Mirror;
  layout?: (component: MirrorEntry) => string;
}

// write one .divebar.mirror.json per component, defaulting to <Name>/<Name>.divebar.mirror.json
export async function writePerComponent(
  opts: WritePerComponentOpts
): Promise<string[]> {
  const layout =
    opts.layout ?? ((c: MirrorEntry) => `${c.name}/${c.name}.divebar.mirror.json`);
  const written: string[] = [];
  for (const component of opts.mirror) {
    const rel = layout(component);
    const abs = `${opts.outputDir}/${rel}`;
    await writeJson(abs, component);
    written.push(abs);
  }
  return written;
}

export interface MirrorDiff {
  added: MirrorEntry[];
  removed: MirrorEntry[];
  changed: MirrorEntry[];
}

// classify components by nodeId presence: only-in-next is added, only-in-prev
// is removed, present-on-both with a non-equal payload is changed
export function mirrorDiff(opts: {
  previous: Mirror;
  next: Mirror;
}): MirrorDiff {
  const prev = new Map(opts.previous.map((c) => [c.nodeId, c] as const));
  const curr = new Map(opts.next.map((c) => [c.nodeId, c] as const));

  const added: MirrorEntry[] = [];
  const removed: MirrorEntry[] = [];
  const changed: MirrorEntry[] = [];

  for (const [id, c] of curr) {
    const before = prev.get(id);
    if (!before) {
      added.push(c);
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(c)) changed.push(c);
  }
  for (const [id, c] of prev) {
    if (!curr.has(id)) removed.push(c);
  }
  return { added, removed, changed };
}
