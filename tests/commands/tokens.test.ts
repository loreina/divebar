import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tokensPull,
  tokensPush,
  tokensPullFromUrl,
  tokensPullFromUrlCore,
  FIGMA_VARIABLES_SCRIPT,
} from '../../src/commands/tokens';
import type { FigmaMcpClient } from '../../src/adapters/figma/client';
import { parseTokensSpec } from '../../src/core/token-parser';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

const ts = {
  tokens: {
    color: { brand: { '500': { $value: '#5B6CFF', $type: 'color' as const } } },
  },
};

test('pull writes tokens.ts and .divebar.json sidecar; push emits a use_figma script', async () => {
  await tokensPull(JSON.stringify(ts), dir);

  const written = await Bun.file(`${dir}/src/tokens.ts`).text();
  expect(written).toContain('export const tokens');
  expect(written).toContain('#5B6CFF');
  expect(written).not.toContain('@divebar-tokens');

  const sidecar = await Bun.file(`${dir}/src/tokens.divebar.json`).text();
  expect(JSON.parse(sidecar)).toEqual(ts);

  const script = await tokensPush(dir);
  expect(script).toContain('upsertVariables');
});

test('tokens pull strips $schema from the sidecar output', async () => {
  const tsWithSchema = {
    $schema: 'https://divebar.dev/schema/tokens/v1.json',
    ...ts,
  };
  await tokensPull(JSON.stringify(tsWithSchema), dir);

  const sidecar = await Bun.file(`${dir}/src/tokens.divebar.json`).text();
  const parsed = JSON.parse(sidecar);
  expect(parsed.$schema).toBeUndefined();
  expect(parsed.tokens).toBeDefined();
});

function fakeFigma(opts: {
  onUseFigma?: (script: string) => unknown | Promise<unknown>;
}): FigmaMcpClient {
  return {
    getDesignContext: async () => null,
    getContextForCodeConnect: async () => null,
    useFigma: async (script: string) => {
      if (opts.onUseFigma) return opts.onUseFigma(script);
      return null;
    },
    getMetadata: async () => [],
    searchDesignSystem: async () => [],
    getVariableDefs: async () => ({ modes: [], variables: [] }),
    dispose: async () => {},
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeMinimalConfig(root: string): Promise<void> {
  const cfg = {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src/components',
    tokensPath: 'src/tokens.ts',
    components: {},
  };
  await writeFile(
    join(root, 'divebar.json'),
    JSON.stringify(cfg, null, 2) + '\n'
  );
}

const SAMPLE_VARIABLES_PAYLOAD = {
  fileKey: 'abc',
  collection: 'main',
  modes: { m1: 'Light', m2: 'Dark' },
  variables: {
    'color.brand.500': {
      type: 'COLOR',
      valuesByMode: { m1: '#5B6CFF', m2: '#1A2BCC' },
    },
    'spacing.md': {
      type: 'FLOAT',
      valuesByMode: { m1: 16, m2: 16 },
    },
  },
};

describe('tokensPullFromUrlCore', () => {
  let urlDir: string;

  beforeEach(async () => {
    urlDir = await mkdtemp(join(tmpdir(), 'spec-tokens-url-'));
  });

  afterEach(async () => {
    await rm(urlDir, { recursive: true, force: true });
  });

  test('happy path writes tokens.ts and tokens.divebar.json with correct content', async () => {
    await writeMinimalConfig(urlDir);
    const figma = fakeFigma({
      onUseFigma: async () => SAMPLE_VARIABLES_PAYLOAD,
    });

    const outcome = await tokensPullFromUrlCore({
      url: 'https://figma.com/design/abc/File',
      root: urlDir,
      flags: { log: () => {} },
      figma,
    });

    expect(outcome.variableCount).toBe(2);
    expect(outcome.modeCount).toBe(2);
    expect(outcome.tokensPath).toBe('src/tokens.ts');
    expect(outcome.specPath).toBe('src/tokens.divebar.json');

    const tsAbs = join(urlDir, 'src/tokens.ts');
    expect(await exists(tsAbs)).toBe(true);
    const tsText = await Bun.file(tsAbs).text();
    expect(tsText).toContain('#5B6CFF');

    const specAbs = join(urlDir, 'src/tokens.divebar.json');
    expect(await exists(specAbs)).toBe(true);
    const specText = await Bun.file(specAbs).text();
    const parsed = parseTokensSpec(specText);
    const brand = (parsed.tokens as Record<string, any>)['color.brand.500'];
    expect(brand).toBeDefined();
    expect(brand.$valuesByMode).toEqual({ m1: '#5B6CFF', m2: '#1A2BCC' });
    expect(brand.$type).toBe('color');
  });

  test('invokes useFigma with the variables script', async () => {
    await writeMinimalConfig(urlDir);
    const calls: string[] = [];
    const figma = fakeFigma({
      onUseFigma: async (script: string) => {
        calls.push(script);
        return SAMPLE_VARIABLES_PAYLOAD;
      },
    });

    await tokensPullFromUrlCore({
      url: 'https://figma.com/design/abc/File',
      root: urlDir,
      flags: { log: () => {} },
      figma,
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('getLocalVariables');
    expect(calls[0]).toContain('figma.variables');
  });

  test('malformed payload throws and writes nothing', async () => {
    await writeMinimalConfig(urlDir);
    const figma = fakeFigma({ onUseFigma: async () => ({ junk: true }) });

    await expect(
      tokensPullFromUrlCore({
        url: 'https://figma.com/design/abc/File',
        root: urlDir,
        flags: { log: () => {} },
        figma,
      })
    ).rejects.toThrow(/^Figma variables payload did not match expected shape:/);

    expect(await exists(join(urlDir, 'src/tokens.ts'))).toBe(false);
    expect(await exists(join(urlDir, 'src/tokens.divebar.json'))).toBe(false);
  });

  test('emits a single progress log on success', async () => {
    await writeMinimalConfig(urlDir);
    const lines: string[] = [];
    const figma = fakeFigma({
      onUseFigma: async () => SAMPLE_VARIABLES_PAYLOAD,
    });

    await tokensPullFromUrlCore({
      url: 'https://figma.com/design/abc/File',
      root: urlDir,
      flags: { log: (m) => lines.push(m) },
      figma,
    });

    expect(lines).toEqual(['✓ Pulled 2 variables across 2 modes']);
  });
});

describe('tokensPullFromUrl', () => {
  let urlDir: string;
  let prevCwd: string;

  beforeEach(async () => {
    urlDir = await mkdtemp(join(tmpdir(), 'spec-tokens-url-prod-'));
    prevCwd = process.cwd();
    process.chdir(urlDir);
  });

  afterEach(async () => {
    try {
      process.chdir(prevCwd);
    } catch {
      // best-effort restore
    }
    await rm(urlDir, { recursive: true, force: true });
  });

  test('missing mcp.figma config throws', async () => {
    await writeMinimalConfig(urlDir);

    await expect(
      tokensPullFromUrl('https://figma.com/design/abc/File', {})
    ).rejects.toThrow('divebar.json has no mcp.figma config');
  });
});

test('FIGMA_VARIABLES_SCRIPT is a non-empty string mentioning the Figma variables APIs', () => {
  expect(typeof FIGMA_VARIABLES_SCRIPT).toBe('string');
  expect(FIGMA_VARIABLES_SCRIPT.length).toBeGreaterThan(0);
  expect(FIGMA_VARIABLES_SCRIPT).toContain('getLocalVariableCollections');
  expect(FIGMA_VARIABLES_SCRIPT).toContain('getLocalVariables');
});

import { tokensImport } from '../../src/commands/tokens';

test('tokens import --from figma fetches via MCP and writes tokens.ts plus spec sidecar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-figtokens-'));
  const fixture = await Bun.file(
    'tests/fixtures/figma-mcp-variable-defs.json'
  ).json();

  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'F',
    modes: ['Consumer', 'Consumer Dark'],
    figma: { getVariableDefs: async () => fixture },
    root: dir,
  });
  expect(Object.keys(ts.tokens)).toContain('color/brand/500');

  const spec = JSON.parse(await Bun.file(`${dir}/src/tokens.divebar.json`).text());
  expect(spec.modes).toEqual([
    { id: '1:0', name: 'Consumer', folder: 'Consumer' },
    { id: '1:1', name: 'Consumer Dark', folder: 'ConsumerDark' },
  ]);
});

test('tokens import --from figma reuses the cache on second call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-figtokens-cache-'));
  const fixture = await Bun.file(
    'tests/fixtures/figma-mcp-variable-defs.json'
  ).json();
  let calls = 0;
  const figma = {
    getVariableDefs: async () => {
      calls++;
      return fixture;
    },
  };
  const cachePath = `${dir}/.figma-cache.json`;
  await tokensImport({
    from: 'figma',
    fileKey: 'F',
    modes: ['Consumer'],
    figma,
    cachePath,
    root: dir,
  });
  await tokensImport({
    from: 'figma',
    fileKey: 'F',
    modes: ['Consumer'],
    figma,
    cachePath,
    root: dir,
  });
  expect(calls).toBe(1);
});

import { spawnSync } from 'bun';

test('CLI: divebar tokens import --from figma --fixture writes tokens.ts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-tokens-cli-'));
  const cli = `${process.cwd()}/src/cli.ts`;
  const fixturePath = `${process.cwd()}/tests/fixtures/figma-mcp-variable-defs.json`;
  const r = spawnSync({
    cmd: [
      'bun',
      cli,
      'tokens',
      'import',
      '--from',
      'figma',
      '--file',
      'F',
      '--modes',
      'Consumer,Consumer Dark',
      '--cache',
      `${dir}/.figma-cache.json`,
      '--fixture',
      fixturePath,
    ],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(r.exitCode).toBe(0);
  const content = await Bun.file(`${dir}/src/tokens.ts`).text();
  expect(content).toContain('tokensByMode');
});

test('tokens import routes through emitters when divebar.json declares them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-emit-route-'));
  await Bun.write(
    `${dir}/divebar.json`,
    JSON.stringify({
      tokens: {
        emitters: ['@divebar/emit-tokens-ts'],
        outDir: 'packages/prism-tokens/src',
      },
    })
  );
  const fixture = await Bun.file(
    'tests/fixtures/figma-mcp-variable-defs.json'
  ).json();
  await tokensImport({
    from: 'figma',
    fileKey: 'F',
    modes: ['Consumer'],
    figma: { getVariableDefs: async () => fixture },
    root: dir,
  });
  const out = await Bun.file(
    `${dir}/packages/prism-tokens/src/tokens.ts`
  ).text();
  expect(out).toContain('tokensByMode');
});
