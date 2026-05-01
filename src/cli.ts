#!/usr/bin/env node
// divebar cli entrypoint. registers every subcommand on a single Command
// instance and delegates the heavy lifting to src/commands/*

import { Command } from 'commander';
import { runParse } from './commands/parse';
import { runGenerate } from './commands/generate';
import { runInspect } from './commands/inspect';
import { runPush } from './commands/push';
import { runBootstrap } from './commands/bootstrap';
import { runInit } from './commands/init';
import { runPull } from './commands/pull';
import { regAdd, regList, regRemove } from './commands/registry';
import {
  tokensPull,
  tokensPush,
  tokensImport,
  tokensPullFromUrl,
} from './commands/tokens';
import { runSync } from './commands/sync';
import { runLint } from './commands/lint';
import {
  mirrorSync,
  writeMirror,
  writePerComponent,
  mirrorDiff,
} from './commands/mirror';
import { assetsSync } from './commands/assets';
import { startFigmaMcp } from './adapters/figma/client';
import type { FigmaMcpClient } from './adapters/figma/client';
import { loadEffectiveRegistry, readRegistry } from './core/registry';
import { MirrorSchema } from './core/mirror-schema';
import type { FigmaMirrorClient } from './commands/mirror';
import { runAudit, formatFindings } from './commands/audit';
import { parseFigmaUrl } from './commands/pull';
import { readText, readJson } from './utils/io';

// ----- top-level setup -----

const program = new Command().name('divebar').version('0.1.0');

// ----- init + project setup -----
// detect editor + framework, write divebar.json, ping mcp
program
  .command('init')
  .description('Set up divebar in this project')
  .option('--yes', 'non-interactive: use detected defaults', false)
  .option(
    '--force',
    'overwrite existing divebar.json by merging missing keys',
    false
  )
  .option('--framework <framework>', 'react | react-native')
  .option('--styling <styling>', 'styled-components | stylesheet | tailwind')
  .option('--mcp-command <command>', 'command to spawn Figma MCP', 'figma-mcp')
  .option(
    '--mcp-args <args...>',
    'args for the MCP command (space-separated after --)'
  )
  .option(
    '--resume',
    'skip already-completed steps for idempotent re-runs',
    false
  )
  .option('--skip-mcp-check', 'skip the MCP ping at the end', false)
  .action(async (opts) => {
    try {
      const outcome = await runInit(process.cwd(), {
        yes: opts.yes,
        force: opts.force,
        framework: opts.framework,
        styling: opts.styling,
        mcpCommand: opts.mcpCommand,
        mcpArgs: opts.mcpArgs,
        resume: opts.resume,
        skipMcpCheck: opts.skipMcpCheck,
      });
      process.exit(outcome.mcp.status === 'failed' ? 1 : 0);
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// ----- figma round-trip in (pull) -----

// pull a figma component into spec + code in one shot
program
  .command('pull <url>')
  .description('Pull a component from a Figma URL into spec + code')
  .option('--name <name>', 'override the component name')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (url, opts) => {
    try {
      await runPull(url, { name: opts.name, workspace: opts.workspace });
      process.exit(0);
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// ----- spec + code (parse, generate, inspect, push, bootstrap) -----

// validate an ir json and re-emit it in canonical form
program
  .command('parse <jsonFile>')
  .description('Validate a component IR JSON and re-emit canonical form')
  .action(async (f) => {
    process.stdout.write((await runParse(await readText(f))) + '\n');
  });

// render the code file for an ir using the registry's adapter + tokens
program
  .command('generate <irFile>')
  .description('Render a code file from an IR')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (f, opts) => {
    console.log(await runGenerate(f, undefined, opts.workspace));
  });

// print the parsed .divebar.json sidecar for a given code file
program
  .command('inspect <codeFile>')
  .description('Read the .divebar.json sidecar for a code file')
  .action(async (f) => {
    process.stdout.write((await runInspect(f)) + '\n');
  });

// render a use_figma script from an ir and send it to figma over the mcp
program
  .command('push <codeFile>')
  .description('Render a use_figma script and send it to Figma over MCP')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .option(
    '--script-only',
    'print the script instead of sending it to Figma',
    false
  )
  .action(async (f, opts) => {
    try {
      const outcome = await runPush(f, {
        workspace: opts.workspace,
        scriptOnly: opts.scriptOnly,
      });

      if (outcome.status === 'script-only') {
        process.stdout.write(outcome.script + '\n');
        return;
      }

      if (outcome.status === 'fallback') {
        console.error('✗ MCP push failed: ' + outcome.error);
        console.error(
          'Falling back to printing the script. Open Figma and run it manually:'
        );
        process.stdout.write(outcome.script + '\n');
        process.exit(1);
      }
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// seed a .divebar.json sidecar or emit a props cache from a component or directory
program
  .command('bootstrap <codePath>')
  .description(
    'Seed a .divebar.json sidecar or emit a props cache from a component or directory'
  )
  .option('--design-tool <tool>', 'design tool name', 'figma')
  .option('--node-id <id>', 'design tool node id')
  .option('--force', 'overwrite existing .divebar.json (sidecar mode only)')
  .option(
    '--emit <mode>',
    'output mode: spec-sidecar | props-cache',
    'spec-sidecar'
  )
  .option('--output <path>', 'output path (props-cache mode only)')
  .action(async (codePath, opts) => {
    const path = await runBootstrap({
      codePath,
      designTool: opts.designTool,
      designNodeId: opts.nodeId,
      force: opts.force,
      emit: opts.emit as 'spec-sidecar' | 'props-cache',
      ...(opts.output ? { outputPath: opts.output } : {}),
    });
    console.log(`✓ wrote ${path}`);
  });

// ----- registry management -----

const reg = program.command('registry');
// register a component entry, optionally scoped to a workspace
reg
  .command('add')
  .requiredOption('--name <n>')
  .requiredOption('--ir-path <p>')
  .option('--framework <f>', 'framework override (react, react-native)')
  .option(
    '--styling <s>',
    'styling override (tailwind, styled-components, stylesheet)'
  )
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (opts) => {
    await regAdd({
      name: opts.name,
      irPath: opts.irPath,
      framework: opts.framework,
      styling: opts.styling,
      workspace: opts.workspace,
    });
  });
// list registered components as tab-separated rows
reg
  .command('list')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (opts) => {
    process.stdout.write((await regList(undefined, opts.workspace)) + '\n');
  });
// remove a component entry from the registry (or workspace, when given)
reg
  .command('remove <name>')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (n, opts) => {
    await regRemove(n, undefined, opts.workspace);
  });

// ----- tokens -----

const tokens = program.command('tokens');
// pull tokens from a json file or directly from a figma url via mcp
tokens
  .command('pull [jsonFile]')
  .option('--url <url>', 'fetch from Figma instead of a JSON file')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (f, opts) => {
    if (opts.url) {
      try {
        await tokensPullFromUrl(opts.url, { workspace: opts.workspace });
      } catch (e) {
        console.error('✗', (e as Error).message);
        process.exit(1);
      }
      return;
    }
    if (!f) {
      console.error(
        '✗ tokens pull requires either <jsonFile> or --url <figma-url>'
      );
      process.exit(1);
    }
    await tokensPull(await readText(f), undefined, opts.workspace);
  });
// render an upsertVariables use_figma script from the local token sidecar
tokens
  .command('push')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (opts) => {
    process.stdout.write((await tokensPush(undefined, opts.workspace)) + '\n');
  });
// import tokens from another tool's format into the canonical token set
tokens
  .command('import [file]')
  .requiredOption(
    '--from <format>',
    'source format (figma, dtcg, style-dictionary)'
  )
  .option('--file <key>', 'Figma file key (required when --from=figma)')
  .option('--modes <list>', 'comma-separated list of mode names')
  .option('--cache <path>', 'cache path for fetched variable defs')
  .option('--fixture <path>', 'JSON fixture instead of spawning Figma MCP')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .option(
    '--name-format <format>',
    'token name format: preserve|camel|dot',
    'preserve'
  )
  .option(
    '--name-prefix <prefix>',
    'optional prefix prepended to every token name'
  )
  .action(async (file, opts) => {
    try {
      if (opts.from === 'figma-variables') {
        throw new Error(
          '--from figma-variables is removed; use --from figma --fixture <path> instead'
        );
      }
      const nameFormat = opts.nameFormat as 'preserve' | 'camel' | 'dot';
      if (
        nameFormat !== 'preserve' &&
        nameFormat !== 'camel' &&
        nameFormat !== 'dot'
      ) {
        throw new Error(
          `--name-format must be one of preserve|camel|dot (got '${opts.nameFormat}')`
        );
      }
      const sharedNormOpts = {
        nameFormat,
        ...(opts.namePrefix !== undefined
          ? { namePrefix: opts.namePrefix as string }
          : {}),
      };
      let ts;
      if (opts.from === 'figma') {
        if (!opts.file) {
          throw new Error('--from figma requires --file <key>');
        }
        let figma: {
          getVariableDefs: (input: {
            fileKey: string;
            modes?: string[];
          }) => Promise<{
            modes: Array<{ modeId: string; name: string }>;
            variables: Array<{
              name: string;
              resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
              valuesByMode: Record<string, string | number | boolean>;
            }>;
          }>;
        };
        if (opts.fixture) {
          const data = await readJson<{
            modes: Array<{ modeId: string; name: string }>;
            variables: Array<{
              name: string;
              resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
              valuesByMode: Record<string, string | number | boolean>;
            }>;
          }>(opts.fixture);
          figma = { getVariableDefs: async () => data };
        } else {
          figma = await connectFigma();
        }
        ts = await tokensImport({
          from: 'figma',
          fileKey: opts.file,
          modes: opts.modes
            ? opts.modes.split(',').map((s: string) => s.trim())
            : [],
          figma,
          ...(opts.cache !== undefined ? { cachePath: opts.cache } : {}),
          ...(opts.workspace !== undefined
            ? { workspace: opts.workspace }
            : {}),
          ...sharedNormOpts,
        });
      } else {
        if (opts.from !== 'dtcg' && opts.from !== 'style-dictionary') {
          throw new Error(
            `--from must be one of figma|dtcg|style-dictionary (got '${opts.from}')`
          );
        }
        if (!file) {
          throw new Error(
            `--from ${opts.from} requires <file> as a positional argument`
          );
        }
        ts = await tokensImport({
          from: opts.from,
          file,
          ...(opts.workspace !== undefined
            ? { workspace: opts.workspace }
            : {}),
          ...sharedNormOpts,
        });
      }
      const modes = ts.modes?.length ?? 0;
      const vars = Object.keys(ts.tokens).length;
      console.log(
        `✓ imported ${vars} variables${modes > 0 ? ` across ${modes} modes` : ''}`
      );
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// ----- sync -----

// reconcile code and figma for a component using the lockfile triple
program
  .command('sync <name>')
  .description('Reconcile code and Figma for a component')
  .option('--figma-hash <h>', 'pre-computed Figma hash (skips MCP re-fetch)')
  .option(
    '--figma-ir <path>',
    'IR file from Figma (used when Figma is the source of truth)'
  )
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (name, opts) => {
    try {
      const out = await runSync({
        name,
        figmaHash: opts.figmaHash,
        figmaIRPath: opts.figmaIr,
        workspace: opts.workspace,
      });
      if (out.computedFigmaHash) {
        console.error(
          `✓ Computed figma hash from MCP: ${out.computedFigmaHash}`
        );
      }
      if (out.message) console.error(out.message);
      if (out.figmaScript) process.stdout.write(out.figmaScript + '\n');
      if (out.decision === 'conflict') process.exit(2);
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// ----- lint, mirror, audit -----

// lint one (or every) component's ir for missing bindings, unknown tokens, gaps
program
  .command('lint [name]')
  .description(
    'Check IR for missing bindings, unknown tokens, and coverage gaps'
  )
  .option('--all', 'lint every registered component')
  .option('--verbose', 'show every missing combination individually')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (name, opts) => {
    const reports = await runLint(
      opts.all ? undefined : name,
      undefined,
      opts.workspace,
      opts.verbose
    );
    let hasError = false;
    for (const report of reports) {
      for (const f of report.findings) {
        const prefix = f.severity === 'error' ? 'error' : 'warning';
        console.error(`${prefix}: [${report.name}] ${f.message}`);
        if (f.severity === 'error') hasError = true;
      }
    }
    if (hasError) process.exit(1);
  });

const mirror = program.command('mirror');
// snapshot every published component set in a figma file to disk
mirror
  .command('sync')
  .requiredOption('--file <key>', 'Figma file key')
  .option('--output <path>', 'mirror output path', '.divebar/mirror.json')
  .option('--per-component', 'write one .divebar.mirror.json per component')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .option(
    '--fixture <path>',
    'use a JSON fixture instead of spawning Figma MCP'
  )
  .action(async (opts) => {
    try {
      const reg = await loadEffectiveRegistry(process.cwd(), {
        workspace: opts.workspace,
      });
      const figma: FigmaMirrorClient = opts.fixture
        ? await loadMirrorFixture(opts.fixture)
        : await connectFigma();
      const result = await mirrorSync({ fileKey: opts.file, figma });
      if (opts.perComponent) {
        const written = await writePerComponent({
          outputDir: reg.outputDir,
          mirror: result,
        });
        for (const w of written) console.log(`✓ wrote ${w}`);
      } else {
        await writeMirror({ output: opts.output, mirror: result });
        console.log(`✓ wrote ${opts.output}`);
      }
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// compare a previous mirror against the current figma state
mirror
  .command('diff')
  .requiredOption('--file <key>', 'Figma file key')
  .requiredOption('--against <path>', 'previous mirror to diff against')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .option(
    '--fixture <path>',
    'use a JSON fixture instead of spawning Figma MCP'
  )
  .action(async (opts) => {
    try {
      await loadEffectiveRegistry(process.cwd(), {
        workspace: opts.workspace,
      });
      const previous = MirrorSchema.parse(await readJson(opts.against));
      const figma: FigmaMirrorClient = opts.fixture
        ? await loadMirrorFixture(opts.fixture)
        : await connectFigma();
      const next = await mirrorSync({ fileKey: opts.file, figma });
      const diff = mirrorDiff({ previous, next });
      for (const c of diff.added) console.log(`+ ${c.name} (${c.nodeId})`);
      for (const c of diff.removed) console.log(`- ${c.name} (${c.nodeId})`);
      for (const c of diff.changed) console.log(`~ ${c.name} (${c.nodeId})`);
      if (diff.added.length + diff.removed.length + diff.changed.length === 0) {
        console.log('✓ no mirror changes');
      }
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// ----- assets -----

const assets = program.command('assets');
// snapshot every published component as a flat asset manifest, optionally
// emitting one .svg per asset alongside the manifest
assets
  .command('sync')
  .requiredOption('--file <key>', 'Figma file key')
  .requiredOption('--output <dir>', 'directory to write assets.json into')
  .option(
    '--fixture <path>',
    'use a JSON fixture instead of spawning Figma MCP'
  )
  .action(async (opts) => {
    try {
      const figma: FigmaMirrorClient = opts.fixture
        ? await loadMirrorFixture(opts.fixture)
        : await connectFigma();
      const manifest = await assetsSync({
        fileKey: opts.file,
        figma,
        outputDir: opts.output,
      });
      console.log(
        `✓ wrote ${manifest.assets.length} assets to ${opts.output}/assets.json`
      );
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// audit a figma frame against the configured + built-in audit rules
program
  .command('audit')
  .description('Audit a Figma frame for design-system issues')
  .requiredOption('--from-figma <url>', 'Figma frame URL with node id')
  .option('--fixture <path>', 'JSON fixture instead of spawning Figma MCP')
  .option(
    '--library-names <list>',
    'comma-separated component names that should be instances'
  )
  .option('--library-keys <list>', 'comma-separated published component keys')
  .option('--workspace <path>', 'workspace root for monorepo mode')
  .action(async (opts) => {
    try {
      const { fileKey, nodeId } = parseFigmaUrl(opts.fromFigma);
      if (!nodeId) {
        throw new Error(
          'audit --from-figma requires a URL with a node-id query parameter'
        );
      }
      let figma: {
        getMetadata: (input: {
          fileKey: string;
          nodeId?: string;
        }) => Promise<unknown[]>;
      };
      if (opts.fixture) {
        const data = await readJson(opts.fixture);
        figma = { getMetadata: async () => [data] };
      } else {
        figma = await connectFigma();
      }
      const reg = await loadEffectiveRegistry(process.cwd(), {
        workspace: opts.workspace,
      });
      const findings = await runAudit({
        fileKey,
        rootNodeId: nodeId,
        figma,
        ...(opts.libraryNames
          ? {
              libraryNames: new Set(
                opts.libraryNames.split(',').map((s: string) => s.trim())
              ),
            }
          : {}),
        ...(opts.libraryKeys
          ? {
              libraryKeys: new Set(
                opts.libraryKeys.split(',').map((s: string) => s.trim())
              ),
            }
          : {}),
        rulePatterns: reg.audit?.rules ?? [],
        root: process.cwd(),
      });
      process.stdout.write(formatFindings(findings) + '\n');
      if (findings.length > 0) process.exit(1);
    } catch (e) {
      console.error('✗', (e as Error).message);
      process.exit(1);
    }
  });

// shared wiring used by every subcommand that talks to figma. reads the
// `mcp.figma` entry from divebar.json and spawns a typed client; throws the
// same actionable error every site used to throw inline
async function connectFigma(): Promise<FigmaMcpClient> {
  const raw = await readRegistry(process.cwd());
  const figmaCfg = raw.mcp?.['figma'];
  if (!figmaCfg) {
    throw new Error(
      'divebar.json has no mcp.figma config; run `divebar init` first.'
    );
  }
  return startFigmaMcp(figmaCfg);
}

// shape of a `--fixture` json used by the mirror/assets commands; mirrors
// what the figma mcp would have returned from get_metadata + search_design_system
interface MirrorFixture {
  get_metadata: Array<{
    id: string;
    name: string;
    children: Array<{ id: string; name: string }>;
  }>;
  search_design_system: Array<{ nodeId: string; key: string }>;
}

async function loadMirrorFixture(path: string): Promise<FigmaMirrorClient> {
  const data = await readJson<MirrorFixture>(path);
  return {
    getMetadata: async () => data.get_metadata,
    searchDesignSystem: async () => data.search_design_system,
  };
}

program.parseAsync(process.argv);
