// `divebar init`: detect editor + framework, write divebar.json, and ping
// the figma mcp. interactive in a tty, else --yes + flags

import { join } from 'node:path';
import { detectEditor } from '../core/editor-detect';
import type { Editor } from '../core/editor-detect';
import { guessFramework } from '../core/framework-detect';
import { startMcpClient } from '../adapters/figma/transport';
import { RegistrySchema, writeRegistry } from '../core/registry';
import { readText, exists } from '../utils/io';
import type { McpServerConfig } from '../core/registry';

// the resolved configuration that gets written to divebar.json
export interface InitConfigInput {
  framework: 'react' | 'react-native';
  styling: 'styled-components' | 'stylesheet' | 'tailwind';
  outputDir: string;
  tokensPath: string;
  mcp?: Record<string, McpServerConfig>;
}

export interface WriteConfigOpts {
  root: string;
  config: InitConfigInput;
  force?: boolean;
}

export interface WriteConfigResult {
  written: 'created' | 'merged';
  path: string;
}

const FILE = 'divebar.json';

// write divebar.json, creating fresh on first run or merging missing keys
// when --force is passed against an existing file. existing keys win on merge
export async function writeInitConfig(
  opts: WriteConfigOpts
): Promise<WriteConfigResult> {
  const path = join(opts.root, FILE);
  const fileExists = await exists(path);

  if (!fileExists) {
    const fresh = RegistrySchema.parse({
      version: '1',
      framework: opts.config.framework,
      styling: opts.config.styling,
      outputDir: opts.config.outputDir,
      tokensPath: opts.config.tokensPath,
      components: {},
      ...(opts.config.mcp !== undefined ? { mcp: opts.config.mcp } : {}),
    });
    await writeRegistry(opts.root, fresh);
    return { written: 'created', path };
  }

  if (!opts.force) {
    throw new Error(
      `divebar.json already exists at ${path}; pass --force to merge missing keys`
    );
  }

  const rawText = await readText(path);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Existing divebar.json failed to parse: ${msg}`);
  }

  const merged: Record<string, unknown> = { ...raw };
  const inputAsRecord = opts.config as unknown as Record<string, unknown>;
  for (const key of MERGE_KEYS) {
    if (!(key in raw)) merged[key] = inputAsRecord[key];
  }
  if (!('version' in merged)) merged['version'] = '1';
  if (!('components' in merged)) merged['components'] = {};

  const validated = RegistrySchema.parse(merged);
  await writeRegistry(opts.root, validated);
  return { written: 'merged', path };
}

// keys merged from the new config when an existing divebar.json is missing them
const MERGE_KEYS = [
  'framework',
  'styling',
  'outputDir',
  'tokensPath',
  'mcp',
] as const;

export interface InitFlags {
  yes?: boolean;
  force?: boolean;
  framework?: 'react' | 'react-native';
  styling?: 'styled-components' | 'stylesheet' | 'tailwind';
  mcpCommand?: string;
  mcpArgs?: string[];
  resume?: boolean;
  skipMcpCheck?: boolean;
  // override the default home dir (for tests)
  homeDir?: string;
  // progress sink; defaults to console.log
  log?: (msg: string) => void;
}

export interface InitOutcome {
  editor: Editor;
  config: { written: 'created' | 'merged' | 'skipped' };
  mcp: { status: 'ok' | 'failed' | 'skipped'; error?: string };
}

const MCP_PING_TIMEOUT_MS = 5000;
const DEFAULT_MCP_COMMAND = 'figma-mcp';
const DEFAULT_MCP_ARGS: ReadonlyArray<string> = ['--dev-mode'];

// race a promise against a timeout, always clearing the timer so a fast
// resolution never leaks a setTimeout handle into the event loop
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errMsg: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errMsg)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// spawn the configured mcp server, list its tools, and dispose. wraps both
// startup and the listTools call in MCP_PING_TIMEOUT_MS so init never hangs
async function pingMcp(
  cmd: string,
  args: string[]
): Promise<{ status: 'ok' | 'failed'; error?: string; toolCount?: number }> {
  try {
    const client = await withTimeout(
      startMcpClient({ command: cmd, args }),
      MCP_PING_TIMEOUT_MS,
      `MCP server did not respond within ${MCP_PING_TIMEOUT_MS}ms`
    );
    try {
      const tools = await withTimeout(
        client.listTools(),
        MCP_PING_TIMEOUT_MS,
        `MCP server did not list tools within ${MCP_PING_TIMEOUT_MS}ms`
      );
      return { status: 'ok', toolCount: tools.length };
    } finally {
      try {
        await client.dispose();
      } catch {
        // best-effort cleanup
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: msg };
  }
}

// pure orchestrator. no prompts; every decision is taken from flags + detection
// runs the init phases sequentially: detect editor, resolve framework, resolve
// mcp config, write divebar.json, ping mcp, print final line
export async function orchestrateInit(
  root: string,
  flags: InitFlags
): Promise<InitOutcome> {
  const log = flags.log ?? ((msg: string) => console.log(msg));

  // ----- 1) detect editor -----
  const detected = await detectEditor(root, flags.homeDir);
  if (detected.editor === 'unknown') {
    log(`→ No editor detected`);
  } else {
    log(`✓ Detected ${detected.editor}`);
  }

  // ----- 2) resolve framework + styling -----
  const guess = await guessFramework(root);
  const frameworkOverride = flags.framework !== undefined;
  const stylingOverride = flags.styling !== undefined;
  const framework = flags.framework ?? guess.framework;
  const styling = flags.styling ?? guess.styling;
  log(`✓ Framework: ${framework}${frameworkOverride ? ' (override)' : ''}`);
  log(`✓ Styling: ${styling}${stylingOverride ? ' (override)' : ''}`);

  // ----- 3) resolve mcp config -----
  const mcpCommand = flags.mcpCommand ?? DEFAULT_MCP_COMMAND;
  const mcpArgs = flags.mcpArgs ?? [...DEFAULT_MCP_ARGS];
  const mcp = { figma: { command: mcpCommand, args: mcpArgs } };

  // ----- 4) write divebar.json -----
  const cfgPath = join(root, 'divebar.json');
  const cfgExists = await exists(cfgPath);
  let writtenStatus: 'created' | 'merged' | 'skipped';

  if (cfgExists && flags.resume) {
    log(`→ divebar.json already exists, skipping`);
    writtenStatus = 'skipped';
  } else {
    const writeResult = await writeInitConfig({
      root,
      config: {
        framework,
        styling,
        outputDir: guess.outputDir,
        tokensPath: guess.tokensPath,
        mcp,
      },
      force: flags.force ?? false,
    });
    writtenStatus = writeResult.written;
    if (writtenStatus === 'created') {
      log(`✓ Wrote divebar.json`);
    } else {
      log(`✓ Merged into existing divebar.json`);
    }
  }

  // ----- 5) ping mcp -----
  let mcpStatus: 'ok' | 'failed' | 'skipped';
  let mcpError: string | undefined;
  if (flags.skipMcpCheck) {
    log(`→ MCP check skipped`);
    mcpStatus = 'skipped';
  } else {
    const ping = await pingMcp(mcpCommand, mcpArgs);
    if (ping.status === 'ok') {
      log(
        `✓ Spawned Figma MCP and verified connection (${ping.toolCount ?? 0} tools)`
      );
      mcpStatus = 'ok';
    } else {
      log(`✗ MCP check failed: ${ping.error ?? 'unknown error'}`);
      mcpStatus = 'failed';
      mcpError = ping.error;
    }
  }

  // ----- 6) final ready line -----
  if (mcpStatus === 'ok') {
    log(`✓ Ready. Try: divebar pull <figma-url>`);
  } else {
    log(
      `! Setup partially complete. Fix the MCP connection then re-run: divebar init --resume`
    );
  }

  return {
    editor: detected.editor,
    config: { written: writtenStatus },
    mcp:
      mcpError !== undefined
        ? { status: mcpStatus, error: mcpError }
        : { status: mcpStatus },
  };
}

// interactive entry point. reads from prompts when flags are missing and
// process.stdout.isTTY; otherwise enforces --yes plus the relevant flags
export async function runInit(
  root: string,
  flags: InitFlags
): Promise<InitOutcome> {
  const isTty = Boolean(process.stdout.isTTY);
  const needsFramework = flags.framework === undefined;
  const needsStyling = flags.styling === undefined;
  const needsMcpCommand = flags.mcpCommand === undefined;

  if (!isTty && flags.yes !== true && (needsFramework || needsStyling)) {
    throw new Error(
      'non-interactive shell requires --yes plus the relevant flags (--framework, --styling, --mcp-command if you want to override defaults)'
    );
  }

  const resolved: InitFlags = { ...flags };

  if (isTty && (needsFramework || needsStyling || needsMcpCommand)) {
    const guess = await guessFramework(root);
    const { select, input } = await import('@inquirer/prompts');
    if (needsFramework) {
      resolved.framework = await select({
        message: 'Framework',
        choices: [
          { value: 'react' as const, name: 'react' },
          { value: 'react-native' as const, name: 'react-native' },
        ],
        default: guess.framework,
      });
    }
    if (needsStyling) {
      resolved.styling = await select({
        message: 'Styling',
        choices: [
          { value: 'styled-components' as const, name: 'styled-components' },
          { value: 'stylesheet' as const, name: 'stylesheet' },
          { value: 'tailwind' as const, name: 'tailwind' },
        ],
        default: guess.styling,
      });
    }
    if (needsMcpCommand) {
      resolved.mcpCommand = await input({
        message: 'Figma MCP command',
        default: DEFAULT_MCP_COMMAND,
      });
    }
  }

  return orchestrateInit(root, resolved);
}
