// `divebar pull`: fetch a figma component into spec + code in one shot
// writes the ir sidecar, registers the component, generates the code file,
// and seeds the lockfile so subsequent `divebar sync` runs have a baseline

import { posix } from 'node:path';
import { z } from 'zod';
import { figmaToComponent } from '../adapters/figma/fetch-mirror';
import { startFigmaMcp } from '../adapters/figma/client';
import type { FigmaMcpClient } from '../adapters/figma/client';
import {
  loadEffectiveRegistry,
  readRegistry,
  addEntryToWorkspace,
} from '../core/registry';
import {
  readLockfile,
  writeLockfile,
  setComponentLock,
} from '../core/lockfile';
import { hashIR } from '../core/hash';
import { ComponentDefinitionSchema } from '../core/schema';
import { canonicalize } from '../utils/canonicalize';
import { safeJoin } from '../utils/safe-path';
import { readText, writeJson } from '../utils/io';
import { runGenerate } from './generate';
import type { ComponentDefinition } from '../core/types';

export interface PullFlags {
  // override the component name (defaults to the name returned by figma)
  name?: string;
  workspace?: string;
  // progress sink; defaults to console.log
  log?: (msg: string) => void;
}

export interface PullOutcome {
  name: string;
  irPath: string;
  codePath: string;
  registered: 'added' | 'updated';
}

// minimal shape used to fish a component name out of mcp responses
const NameOnlySchema = z.object({ name: z.string().min(1) });

// matches both /design/ and /file/ figma urls; capture 1 is the fileKey,
// capture 2 is the raw query string we pull node-id from
const FIGMA_URL_PATTERN =
  /^https?:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([^/?#]+)(?:\/[^?#]*)?(?:\?([^#]*))?$/;

// extract fileKey and (optional) nodeId. figma urls encode the node-id with
// dashes; we restore the colon form used by the plugin api
export function parseFigmaUrl(url: string): {
  fileKey: string;
  nodeId: string | null;
} {
  const match = FIGMA_URL_PATTERN.exec(url);
  if (!match) throw new Error(`Not a Figma file URL: ${url}`);
  const fileKey = match[1]!;
  const query = match[2];
  let nodeId: string | null = null;
  if (query) {
    const params = new URLSearchParams(query);
    const raw = params.get('node-id');
    if (raw) nodeId = raw.replace(/-/g, ':');
  }
  return { fileKey, nodeId };
}

// inverse of parseFigmaUrl. builds a canonical figma design url from
// fileKey + nodeId, encoding the colon-form id back to its dashed url form
export function buildFigmaUrl(designSource: {
  fileKey?: string;
  nodeId?: string;
}): string {
  const { fileKey, nodeId } = designSource;
  if (!fileKey) {
    throw new Error('designSource.fileKey is required to rebuild a Figma URL');
  }
  const base = `https://www.figma.com/design/${fileKey}/file`;
  if (!nodeId) return base;
  return `${base}?node-id=${nodeId.replace(/:/g, '-')}`;
}

// stable sha-256 of an arbitrary string, used for code/figma hash columns
async function hashOfString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// place the .divebar.json sidecar next to the generated code file
function siblingIrPath(codePath: string, name: string): string {
  const dir = posix.dirname(codePath);
  return dir === '.' ? `${name}.divebar.json` : posix.join(dir, `${name}.divebar.json`);
}

// pure orchestrator. accepts an injected mcp client so tests can drive the
// flow with fixtures. writes the ir, registers the component, generates code,
// and updates the lockfile in one pass
export async function runPullCore(opts: {
  url: string;
  root: string;
  flags: PullFlags;
  figma: FigmaMcpClient;
}): Promise<PullOutcome> {
  const log = opts.flags.log ?? ((m: string) => console.log(m));

  parseFigmaUrl(opts.url);

  const designContext = await opts.figma.getDesignContext(opts.url);
  const codeConnect = await opts.figma.getContextForCodeConnect(opts.url);

  let name: string;
  if (opts.flags.name !== undefined) {
    name = opts.flags.name;
  } else {
    const result = NameOnlySchema.safeParse(designContext);
    if (!result.success) {
      throw new Error('Figma MCP response missing required field "name"');
    }
    name = result.data.name;
  }

  const reg = await loadEffectiveRegistry(opts.root, {
    name,
    workspace: opts.flags.workspace,
  });

  const existingEntry = reg.components[name];
  let codePath: string;
  if (existingEntry) {
    const text = await readText(safeJoin(reg.root, existingEntry.irPath));
    const ir = ComponentDefinitionSchema.parse(
      JSON.parse(text)
    ) as unknown as ComponentDefinition;
    codePath = ir.codePath;
  } else {
    codePath = posix.join(reg.outputDir, `${name}.tsx`);
  }

  const irPath = siblingIrPath(codePath, name);

  const ir = figmaToComponent(designContext, codeConnect, { codePath });
  if (opts.flags.name !== undefined) ir.name = name;

  const irAbs = safeJoin(reg.root, irPath);
  await writeJson(irAbs, ir);

  const workspaceRoot = opts.flags.workspace ?? '.';
  await addEntryToWorkspace(opts.root, workspaceRoot, {
    name,
    irPath,
    framework: undefined,
    styling: undefined,
    lastSynced: new Date().toISOString(),
  });

  await runGenerate(irAbs, opts.root, opts.flags.workspace);

  const codeAbs = safeJoin(reg.root, codePath);
  const codeText = await readText(codeAbs);
  const codeHash = await hashOfString(codeText);
  const figmaHash = await hashOfString(canonicalize(designContext));
  const irHash = await hashIR(ir);

  const lock = await readLockfile(reg.root);
  await writeLockfile(
    reg.root,
    setComponentLock(lock, name, { figmaHash, codeHash, irHash })
  );

  log(`✓ Pulled ${name} from Figma`);
  log(`✓ Wrote ${irPath}`);
  log(`✓ Wrote ${codePath}`);
  log(`✓ Updated divebar.lock`);

  return {
    name,
    irPath,
    codePath,
    registered: existingEntry ? 'updated' : 'added',
  };
}

// production entry. spawns the figma mcp from divebar.json and disposes after
export async function runPull(
  url: string,
  flags: PullFlags
): Promise<PullOutcome> {
  const root = process.cwd();
  const raw = await readRegistry(root);
  const figmaCfg = raw.mcp?.['figma'];
  if (!figmaCfg) {
    throw new Error(
      'divebar.json has no mcp.figma config; run `divebar init` first.'
    );
  }
  const figma = await startFigmaMcp(figmaCfg);
  try {
    return await runPullCore({ url, root, flags, figma });
  } finally {
    try {
      await figma.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}
