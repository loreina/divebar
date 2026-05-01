// `divebar push`: render a use_figma script from a code file's ir + tokens
// and (unless --script-only) send it over the figma mcp

import { runInspect } from './inspect';
import { figmaAdapter } from '../adapters/figma';
import { parseTokensSpec } from '../core/token-parser';
import { loadEffectiveRegistry, readRegistry } from '../core/registry';
import { startFigmaMcp } from '../adapters/figma/client';
import type { FigmaMcpClient } from '../adapters/figma/client';
import { safeJoin } from '../utils/safe-path';
import { readText, exists } from '../utils/io';

export interface PushFlags {
  workspace?: string;
  // when true, skip mcp entirely and just return the script string
  scriptOnly?: boolean;
  // progress sink; defaults to console.log
  log?: (msg: string) => void;
}

export type PushStatus = 'sent' | 'script-only' | 'fallback';

export interface PushOutcome {
  // the rendered use_figma script; always present
  script: string;
  // what actually happened during the run
  status: PushStatus;
  // error message when status is 'fallback'
  error?: string;
  // component name pulled from the ir
  name: string;
}

// pure orchestrator. accepts an injected mcp client (or null for script-only)
// so tests can drive the flow without a real figma server
export async function runPushCore(opts: {
  file: string;
  root: string;
  flags: PushFlags;
  figma: FigmaMcpClient | null;
}): Promise<PushOutcome> {
  const log = opts.flags.log ?? ((m: string) => console.log(m));

  const ir = JSON.parse(await runInspect(opts.file, opts.root));
  const reg = await loadEffectiveRegistry(opts.root, {
    name: ir.name,
    workspace: opts.flags.workspace,
  });
  const tokens = await loadTokens(reg.root, reg.tokensPath, reg.tokensJsonPath);
  const script = figmaAdapter.renderComponent(ir, tokens, reg.figma);

  if (opts.flags.scriptOnly === true || opts.figma === null) {
    return { script, status: 'script-only', name: ir.name };
  }

  try {
    await opts.figma.useFigma(script);
    log(`✓ Pushed ${ir.name} to Figma`);
    return { script, status: 'sent', name: ir.name };
  } catch (e) {
    return {
      script,
      status: 'fallback',
      error: (e as Error).message,
      name: ir.name,
    };
  }
}

// production entry. for --script-only short-circuits to runPushCore with no
// client; otherwise spawns the figma mcp from divebar.json and disposes after
export async function runPush(
  file: string,
  flags: PushFlags
): Promise<PushOutcome> {
  const root = process.cwd();

  if (flags.scriptOnly) {
    return runPushCore({ file, root, flags, figma: null });
  }

  const reg = await readRegistry(root);
  const figmaCfg = reg.mcp?.['figma'];
  if (!figmaCfg) {
    throw new Error(
      'divebar.json has no mcp.figma config; pass --script-only or run `divebar init` first.'
    );
  }

  const figma = await startFigmaMcp(figmaCfg);
  try {
    return await runPushCore({ file, root, flags, figma });
  } finally {
    try {
      await figma.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}

// load the spec sidecar, falling back to an empty token set
async function loadTokens(
  root: string,
  tokensPath: string,
  tokensJsonPath?: string
) {
  const specPath = tokensJsonPath
    ? safeJoin(root, tokensJsonPath)
    : safeJoin(root, tokensPath).replace(/\.ts$/, '.divebar.json');

  if (await exists(specPath)) {
    return parseTokensSpec(await readText(specPath));
  }
  return { tokens: {} };
}
