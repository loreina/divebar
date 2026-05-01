import { test, describe, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateInit, writeInitConfig } from '../../src/commands/init';
import type { InitConfigInput } from '../../src/commands/init';
import { readJson, exists } from '../../src/utils/io';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spec-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const baseInput: InitConfigInput = {
  framework: 'react-native',
  styling: 'stylesheet',
  outputDir: 'src/components',
  tokensPath: 'src/tokens.ts',
  mcp: {
    figma: { command: 'figma-mcp', args: ['--dev-mode'] },
  },
};

test('fresh write into empty dir creates divebar.json with all input fields', async () => {
  const result = await writeInitConfig({ root: dir, config: baseInput });

  expect(result.written).toBe('created');
  expect(result.path).toBe(join(dir, 'divebar.json'));

  const parsed = await readJson<Record<string, unknown>>(result.path);
  expect(parsed['version']).toBe('1');
  expect(parsed['framework']).toBe('react-native');
  expect(parsed['styling']).toBe('stylesheet');
  expect(parsed['outputDir']).toBe('src/components');
  expect(parsed['tokensPath']).toBe('src/tokens.ts');
  expect(parsed['mcp']).toEqual({
    figma: { command: 'figma-mcp', args: ['--dev-mode'] },
  });
  expect(parsed['components']).toEqual({});
});

test('refuses to overwrite without force', async () => {
  await writeInitConfig({ root: dir, config: baseInput });
  const expectedPath = join(dir, 'divebar.json');
  await expect(
    writeInitConfig({ root: dir, config: baseInput })
  ).rejects.toThrow(
    `divebar.json already exists at ${expectedPath}; pass --force to merge missing keys`
  );
});

test('force overwrite preserves user-edited framework', async () => {
  await writeInitConfig({
    root: dir,
    config: { ...baseInput, framework: 'react' },
  });

  const path = join(dir, 'divebar.json');
  const userEdited = await readJson<Record<string, unknown>>(path);
  userEdited['framework'] = 'react-native';
  await writeFile(path, JSON.stringify(userEdited, null, 2) + '\n');

  const result = await writeInitConfig({
    root: dir,
    config: { ...baseInput, framework: 'react' },
    force: true,
  });
  expect(result.written).toBe('merged');

  const final = await readJson<Record<string, unknown>>(path);
  expect(final['framework']).toBe('react-native');
});

test('force overwrite fills missing keys', async () => {
  const path = join(dir, 'divebar.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        version: '1',
        framework: 'react',
        styling: 'styled-components',
        outputDir: 'src/components',
        components: {},
      },
      null,
      2
    ) + '\n'
  );

  const result = await writeInitConfig({
    root: dir,
    config: baseInput,
    force: true,
  });
  expect(result.written).toBe('merged');

  const final = await readJson<Record<string, unknown>>(path);
  expect(final['tokensPath']).toBe('src/tokens.ts');
  expect(final['framework']).toBe('react');
  expect(final['styling']).toBe('styled-components');
});

test('force overwrite preserves existing mcp config', async () => {
  const path = join(dir, 'divebar.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        version: '1',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src/components',
        tokensPath: 'src/tokens.ts',
        components: {},
        mcp: { figma: { command: 'custom', args: ['--x'] } },
      },
      null,
      2
    ) + '\n'
  );

  const result = await writeInitConfig({
    root: dir,
    config: { ...baseInput, mcp: { figma: { command: 'figma-mcp' } } },
    force: true,
  });
  expect(result.written).toBe('merged');

  const final = await readJson<Record<string, unknown>>(path);
  expect(final['mcp']).toEqual({
    figma: { command: 'custom', args: ['--x'] },
  });
});

test('force overwrite adds mcp when missing', async () => {
  const path = join(dir, 'divebar.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        version: '1',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src/components',
        tokensPath: 'src/tokens.ts',
        components: {},
      },
      null,
      2
    ) + '\n'
  );

  const result = await writeInitConfig({
    root: dir,
    config: baseInput,
    force: true,
  });
  expect(result.written).toBe('merged');

  const final = await readJson<Record<string, unknown>>(path);
  expect(final['mcp']).toEqual({
    figma: { command: 'figma-mcp', args: ['--dev-mode'] },
  });
});

test("created config carries version: '1'", async () => {
  const result = await writeInitConfig({ root: dir, config: baseInput });
  const parsed = await readJson<Record<string, unknown>>(result.path);
  expect(parsed['version']).toBe('1');
});

test('components map stays empty after a fresh write', async () => {
  const result = await writeInitConfig({ root: dir, config: baseInput });
  const parsed = await readJson<Record<string, unknown>>(result.path);
  expect(parsed['components']).toEqual({});
});

test('force-merge fills detected non-default values into a partial config', async () => {
  const path = join(dir, 'divebar.json');
  await writeFile(path, JSON.stringify({ framework: 'react' }) + '\n');

  const res = await writeInitConfig({
    root: dir,
    config: {
      framework: 'react',
      styling: 'styled-components',
      outputDir: 'src/components',
      tokensPath: 'packages/web/src/tokens.ts',
      mcp: { figma: { command: 'figma-mcp' } },
    },
    force: true,
  });

  expect(res.written).toBe('merged');
  const written = await readJson<Record<string, unknown>>(path);
  expect(written['framework']).toBe('react');
  expect(written['tokensPath']).toBe('packages/web/src/tokens.ts');
  expect(written['mcp']).toEqual({ figma: { command: 'figma-mcp' } });
});

describe('orchestrateInit', () => {
  let root: string;
  let homeDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spec-orch-root-'));
    homeDir = await mkdtemp(join(tmpdir(), 'spec-orch-home-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  test('happy path: empty workspace with all flags spawns MCP and writes everything', async () => {
    const outcome = await orchestrateInit(root, {
      yes: true,
      framework: 'react',
      styling: 'stylesheet',
      mcpCommand: 'bun',
      mcpArgs: ['run', 'tests/fixtures/fake-figma-mcp-server.ts'],
      homeDir,
      log: () => {},
    });

    expect(outcome.config.written).toBe('created');
    expect(outcome.mcp.status).toBe('ok');
    expect(await exists(join(root, 'divebar.json'))).toBe(true);
  });

  test('existing divebar.json without --force or --resume throws', async () => {
    await writeFile(
      join(root, 'divebar.json'),
      JSON.stringify({ version: '1' }) + '\n'
    );

    await expect(
      orchestrateInit(root, {
        yes: true,
        framework: 'react',
        styling: 'stylesheet',
        homeDir,
        skipMcpCheck: true,
        log: () => {},
      })
    ).rejects.toThrow(/already exists/);
  });

  test('existing divebar.json with --force shallow-merges into outcome', async () => {
    const cfgPath = join(root, 'divebar.json');
    await writeFile(
      cfgPath,
      JSON.stringify(
        {
          version: '1',
          framework: 'react',
          styling: 'styled-components',
          outputDir: 'src/components',
          tokensPath: 'tokens.ts',
          components: { existing: { irPath: 'foo.json' } },
        },
        null,
        2
      ) + '\n'
    );

    const outcome = await orchestrateInit(root, {
      yes: true,
      force: true,
      framework: 'react-native',
      styling: 'stylesheet',
      mcpCommand: 'figma-mcp',
      homeDir,
      skipMcpCheck: true,
      log: () => {},
    });

    expect(outcome.config.written).toBe('merged');
    const final = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<
      string,
      unknown
    >;
    // existing keys win in shallow merge
    expect(final['framework']).toBe('react');
    expect(final['components']).toEqual({ existing: { irPath: 'foo.json' } });
  });

  test('existing divebar.json with --resume skips writing', async () => {
    const cfgPath = join(root, 'divebar.json');
    const original =
      JSON.stringify(
        {
          version: '1',
          framework: 'react',
          styling: 'styled-components',
          outputDir: 'src/components',
          tokensPath: 'tokens.ts',
          components: {},
        },
        null,
        2
      ) + '\n';
    await writeFile(cfgPath, original);

    const outcome = await orchestrateInit(root, {
      yes: true,
      resume: true,
      framework: 'react-native',
      styling: 'stylesheet',
      homeDir,
      skipMcpCheck: true,
      log: () => {},
    });

    expect(outcome.config.written).toBe('skipped');
    const onDisk = await readFile(cfgPath, 'utf8');
    expect(onDisk).toBe(original);
  });

  test('MCP ping failure surfaces but config still gets written', async () => {
    const outcome = await orchestrateInit(root, {
      yes: true,
      framework: 'react',
      styling: 'stylesheet',
      mcpCommand: 'this-command-does-not-exist-xyzzy',
      homeDir,
      log: () => {},
    });

    expect(outcome.mcp.status).toBe('failed');
    expect(typeof outcome.mcp.error).toBe('string');
    expect((outcome.mcp.error ?? '').length).toBeGreaterThan(0);
    expect(await exists(join(root, 'divebar.json'))).toBe(true);
  });

  test('--skip-mcp-check sets mcp.status to skipped and never spawns', async () => {
    const outcome = await orchestrateInit(root, {
      yes: true,
      framework: 'react',
      styling: 'stylesheet',
      mcpCommand: 'figma-mcp',
      homeDir,
      skipMcpCheck: true,
      log: () => {},
    });

    expect(outcome.mcp.status).toBe('skipped');
    expect(outcome.mcp.error).toBeUndefined();
  });

  test('--framework override beats the package.json guess', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'rn-app',
        dependencies: { 'react-native': '0.74.0' },
      }) + '\n'
    );

    const outcome = await orchestrateInit(root, {
      yes: true,
      framework: 'react',
      styling: 'styled-components',
      homeDir,
      skipMcpCheck: true,
      log: () => {},
    });

    expect(outcome.config.written).toBe('created');
    const written = JSON.parse(
      await readFile(join(root, 'divebar.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(written['framework']).toBe('react');
  });

  test('--mcp-command writes through into divebar.json', async () => {
    await orchestrateInit(root, {
      yes: true,
      framework: 'react',
      styling: 'stylesheet',
      mcpCommand: 'my-custom-mcp',
      homeDir,
      skipMcpCheck: true,
      log: () => {},
    });

    const written = JSON.parse(
      await readFile(join(root, 'divebar.json'), 'utf8')
    ) as Record<string, unknown>;
    const mcp = written['mcp'] as Record<string, { command: string }>;
    expect(mcp['figma']!.command).toBe('my-custom-mcp');
  });
});
