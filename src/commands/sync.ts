// `divebar sync`: reconcile code and figma for one component using the
// lockfile triple. delegates the decision to core/sync.decideSync, then
// renders the chosen side and updates divebar.lock

import {
  loadEffectiveRegistry,
  resolveTarget,
  readRegistry,
} from '../core/registry';
import {
  readLockfile,
  writeLockfile,
  setComponentLock,
} from '../core/lockfile';
import { decideSync } from '../core/sync';
import { hashIR } from '../core/hash';
import { selectAdapter } from '../adapters';
import { figmaAdapter } from '../adapters/figma';
import { parseTokensSpec } from '../core/token-parser';
import { ComponentDefinitionSchema } from '../core/schema';
import { safeJoin } from '../utils/safe-path';
import { startFigmaMcp } from '../adapters/figma/client';
import type { FigmaMcpClient } from '../adapters/figma/client';
import { buildFigmaUrl } from './pull';
import { readText, writeText, writeJson, exists } from '../utils/io';
import type { ComponentDefinition } from '../core/types';

export interface SyncInputs {
  name: string;
  // when omitted, runSync re-fetches via mcp and computes the hash internally
  figmaHash?: string;
  figmaIRPath?: string;
  root?: string;
  workspace?: string;
}

export interface SyncOutput {
  decision:
    | 'noop'
    | 'render-code'
    | 'render-figma'
    | 'render-both'
    | 'conflict';
  figmaScript?: string;
  message?: string;
  // when sync re-fetched, the hash it computed (callers may want to log it)
  computedFigmaHash?: string;
}

// pure orchestrator. accepts an injected mcp client so tests can drive the
// flow without spawning figma. handles every decideSync outcome in one place
export async function runSyncCore(
  input: SyncInputs & { figma?: FigmaMcpClient | null }
): Promise<SyncOutput> {
  const root = input.root ?? process.cwd();
  const reg = await loadEffectiveRegistry(root, {
    name: input.name,
    workspace: input.workspace,
  });
  const entry = reg.components[input.name];
  if (!entry) throw new Error(`unknown component ${input.name}`);

  const irText = await readText(safeJoin(reg.root, entry.irPath));
  const existingIR = ComponentDefinitionSchema.parse(
    JSON.parse(irText)
  ) as unknown as ComponentDefinition;
  const codePath = existingIR.codePath;

  let figmaHash: string;
  let computedFigmaHash: string | undefined;
  if (input.figmaHash !== undefined && input.figmaHash !== '') {
    figmaHash = input.figmaHash;
  } else {
    if (!input.figma) {
      throw new Error(
        'sync requires either --figma-hash or a Figma MCP client to fetch the hash'
      );
    }
    const fileKey = existingIR.designSource?.fileKey;
    if (!fileKey) {
      throw new Error(
        `cannot re-fetch hash: ${input.name} has no designSource.fileKey in its spec`
      );
    }
    const url = buildFigmaUrl({
      fileKey,
      ...(existingIR.designSource?.nodeId !== undefined
        ? { nodeId: existingIR.designSource.nodeId }
        : {}),
    });
    const designContext = await input.figma.getDesignContext(url);
    figmaHash = await hashIR(designContext);
    computedFigmaHash = figmaHash;
  }

  const lock = await readLockfile(reg.root);
  const last = lock.components[input.name];

  const codeText = await readOptional(safeJoin(reg.root, codePath));
  const codeHash = await hashOfString(codeText);

  const decision = decideSync(last, figmaHash, codeHash);
  const adapter = selectAdapter(resolveTarget(reg, input.name));
  const tokens = await loadTokens(reg.root, reg.tokensPath, reg.tokensJsonPath);

  if (decision.kind === 'noop') {
    return {
      decision: 'noop',
      ...(computedFigmaHash !== undefined ? { computedFigmaHash } : {}),
    };
  }

  if (decision.kind === 'conflict') {
    return {
      decision: 'conflict',
      message:
        `Both Figma and ${codePath} have changed since last sync. ` +
        `Reset one side and re-run.`,
      ...(computedFigmaHash !== undefined ? { computedFigmaHash } : {}),
    };
  }

  if (decision.kind === 'render-code' || decision.kind === 'render-both') {
    if (!input.figmaIRPath)
      throw new Error('figma drift but no figmaIRPath provided');
    const ir = ComponentDefinitionSchema.parse(
      JSON.parse(await readText(input.figmaIRPath))
    ) as unknown as ComponentDefinition;

    const { $schema: _schema, ...cleanIR } = ir;
    await writeJson(safeJoin(reg.root, entry.irPath), cleanIR);

    const code = adapter.render(ir, tokens, reg.theme ?? undefined);
    await writeText(safeJoin(reg.root, codePath), code);
    const newCodeHash = await hashOfString(code);
    const irHash = await hashIR(ir);
    await writeLockfile(
      reg.root,
      setComponentLock(lock, input.name, {
        figmaHash,
        codeHash: newCodeHash,
        irHash,
      })
    );
    return {
      decision: decision.kind,
      ...(computedFigmaHash !== undefined ? { computedFigmaHash } : {}),
    };
  }

  const irHash = await hashIR(existingIR);
  const figmaScript = figmaAdapter.renderComponent(
    existingIR,
    tokens,
    reg.figma
  );
  await writeLockfile(
    reg.root,
    setComponentLock(lock, input.name, {
      figmaHash,
      codeHash,
      irHash,
    })
  );
  return {
    decision: 'render-figma',
    figmaScript,
    ...(computedFigmaHash !== undefined ? { computedFigmaHash } : {}),
  };
}

// production entry. if figmaHash is omitted, spawns figma mcp from divebar.json
export async function runSync(input: SyncInputs): Promise<SyncOutput> {
  const root = input.root ?? process.cwd();

  if (input.figmaHash !== undefined && input.figmaHash !== '') {
    return runSyncCore({ ...input, figma: null });
  }

  const reg = await readRegistry(root);
  const figmaCfg = reg.mcp?.['figma'];
  if (!figmaCfg) {
    throw new Error(
      'divebar.json has no mcp.figma config; pass --figma-hash or run `divebar init` first.'
    );
  }
  const figma = await startFigmaMcp(figmaCfg);
  try {
    return await runSyncCore({ ...input, figma });
  } finally {
    try {
      await figma.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}

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

async function readOptional(path: string): Promise<string> {
  if (!(await exists(path))) return '';
  return readText(path);
}

async function hashOfString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
