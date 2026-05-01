// `divebar assets sync`: wrap mirrorSync to produce an asset-shaped manifest
// (and optional .svg files) suitable for projects that want a flat icon
// catalog rather than the full per-component mirror

import { mirrorSync, type FigmaMirrorClient } from './mirror';
import { writeJson, writeText } from '../utils/io';
import type { MirrorEntry } from '../core/mirror-schema';

export interface AssetEntry {
  name: string;
  nodeId: string;
  componentKey: string | null;
}

export interface AssetManifest {
  fileKey: string;
  generatedAt: string;
  assets: AssetEntry[];
}

export interface AssetsSyncOpts {
  fileKey: string;
  figma: FigmaMirrorClient;
  outputDir: string;
  exportSvg?: (entry: MirrorEntry) => Promise<string> | string;
}

export async function assetsSync(opts: AssetsSyncOpts): Promise<AssetManifest> {
  const mirror = await mirrorSync({
    fileKey: opts.fileKey,
    figma: opts.figma,
  });
  const assets: AssetEntry[] = mirror.map((entry) => ({
    name: entry.name,
    nodeId: entry.nodeId,
    componentKey: entry.componentKey,
  }));

  const manifest: AssetManifest = {
    fileKey: opts.fileKey,
    generatedAt: new Date().toISOString(),
    assets,
  };

  await writeJson(`${opts.outputDir}/assets.json`, manifest);

  if (opts.exportSvg) {
    for (const entry of mirror) {
      const svg = await opts.exportSvg(entry);
      await writeText(`${opts.outputDir}/${entry.name}.svg`, svg);
    }
  }

  return manifest;
}
