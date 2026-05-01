import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFigmaUrl,
  buildFigmaUrl,
  runPullCore,
  runPull,
} from '../../src/commands/pull';
import type { FigmaMcpClient } from '../../src/adapters/figma/client';
import { ComponentDefinitionSchema } from '../../src/core/schema';

const FIXTURE_DIR = 'tests/fixtures/figma-mcp';

async function loadFixture(name: string): Promise<unknown> {
  return Bun.file(`${FIXTURE_DIR}/${name}`).json();
}

function fakeFigma(
  designContext: unknown,
  codeConnect: unknown
): FigmaMcpClient {
  return {
    getDesignContext: async () => designContext,
    getContextForCodeConnect: async () => codeConnect,
    useFigma: async () => null,
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

async function writeBaseConfig(
  root: string,
  opts?: { withMcp?: boolean }
): Promise<void> {
  const cfg: Record<string, unknown> = {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src/components',
    tokensPath: 'src/tokens.ts',
    components: {},
  };
  if (opts?.withMcp !== false) {
    cfg['mcp'] = { figma: { command: 'figma-mcp', args: ['--dev-mode'] } };
  }
  await writeFile(
    join(root, 'divebar.json'),
    JSON.stringify(cfg, null, 2) + '\n'
  );
}

const URL_BASE =
  'https://www.figma.com/design/abc123Key/MyFile?node-id=123-456&t=AbCdEf';

describe('parseFigmaUrl', () => {
  test('design URL with node-id converts dash to colon', () => {
    expect(parseFigmaUrl(URL_BASE)).toEqual({
      fileKey: 'abc123Key',
      nodeId: '123:456',
    });
  });

  test('missing node-id returns null', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/abc123Key/MyFile')
    ).toEqual({ fileKey: 'abc123Key', nodeId: null });
  });

  test('legacy /file/ URL still parses', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/file/legacyKey/Old?node-id=10-20')
    ).toEqual({ fileKey: 'legacyKey', nodeId: '10:20' });
  });

  test('non-Figma URL throws', () => {
    expect(() => parseFigmaUrl('https://example.com/foo')).toThrow(
      'Not a Figma file URL: https://example.com/foo'
    );
  });
});

describe('buildFigmaUrl', () => {
  test('buildFigmaUrl rebuilds a design URL with colon→dash node-id', () => {
    expect(buildFigmaUrl({ fileKey: 'abc123', nodeId: '1:23' })).toBe(
      'https://www.figma.com/design/abc123/file?node-id=1-23'
    );
  });

  test('buildFigmaUrl with no node-id', () => {
    expect(buildFigmaUrl({ fileKey: 'abc123' })).toBe(
      'https://www.figma.com/design/abc123/file'
    );
  });

  test('buildFigmaUrl throws on missing fileKey', () => {
    expect(() => buildFigmaUrl({ nodeId: '1:2' })).toThrow(
      /fileKey is required/
    );
  });

  test('parseFigmaUrl ∘ buildFigmaUrl is identity for fileKey/nodeId pairs', () => {
    const round = parseFigmaUrl(
      buildFigmaUrl({ fileKey: 'XYZ', nodeId: '7:42' })
    );
    expect(round).toEqual({ fileKey: 'XYZ', nodeId: '7:42' });
  });
});

describe('runPullCore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-pull-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('new component happy path', async () => {
    await writeBaseConfig(dir);
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');

    const outcome = await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { log: () => {} },
      figma: fakeFigma(dc, cc),
    });

    expect(outcome).toEqual({
      name: 'Button',
      irPath: 'src/components/Button.divebar.json',
      codePath: 'src/components/Button.tsx',
      registered: 'added',
    });

    const irRaw = await readFile(
      join(dir, 'src/components/Button.divebar.json'),
      'utf8'
    );
    expect(() =>
      ComponentDefinitionSchema.parse(JSON.parse(irRaw))
    ).not.toThrow();

    const code = await readFile(join(dir, 'src/components/Button.tsx'), 'utf8');
    expect(code).toContain('Button');

    const cfgRaw = JSON.parse(
      await readFile(join(dir, 'divebar.json'), 'utf8')
    ) as { components: Record<string, { irPath: string }> };
    expect(cfgRaw.components.Button?.irPath).toBe(
      'src/components/Button.divebar.json'
    );

    const lockRaw = JSON.parse(
      await readFile(join(dir, 'divebar.lock'), 'utf8')
    ) as {
      components: Record<
        string,
        { figmaHash: string; codeHash: string; irHash: string }
      >;
    };
    const entry = lockRaw.components.Button;
    expect(entry).toBeDefined();
    expect((entry?.figmaHash ?? '').length).toBeGreaterThan(0);
    expect((entry?.codeHash ?? '').length).toBeGreaterThan(0);
    expect((entry?.irHash ?? '').length).toBeGreaterThan(0);
  });

  test('existing component preserves codePath', async () => {
    const seedIr = {
      name: 'Button',
      codePath: 'packages/web/Button.tsx',
      designSource: { tool: 'figma' },
      variants: {},
      slots: [],
      styles: [],
      semantics: {},
    };
    const cfg = {
      version: '1',
      framework: 'react',
      styling: 'styled-components',
      outputDir: 'src/components',
      tokensPath: 'src/tokens.ts',
      components: {
        Button: { irPath: 'packages/web/Button.divebar.json' },
      },
      mcp: { figma: { command: 'figma-mcp' } },
    };
    await mkdir(join(dir, 'packages/web'), { recursive: true });
    await writeFile(
      join(dir, 'divebar.json'),
      JSON.stringify(cfg, null, 2) + '\n'
    );
    await writeFile(
      join(dir, 'packages/web/Button.divebar.json'),
      JSON.stringify(seedIr, null, 2) + '\n'
    );

    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');

    const outcome = await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { log: () => {} },
      figma: fakeFigma(dc, cc),
    });

    expect(outcome.codePath).toBe('packages/web/Button.tsx');
    expect(outcome.irPath).toBe('packages/web/Button.divebar.json');
    expect(outcome.registered).toBe('updated');

    expect(await exists(join(dir, 'packages/web/Button.tsx'))).toBe(true);
    expect(await exists(join(dir, 'packages/web/Button.divebar.json'))).toBe(true);
    expect(await exists(join(dir, 'src/components/Button.tsx'))).toBe(false);
  });

  test('flags.name override', async () => {
    await writeBaseConfig(dir);
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');

    const outcome = await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { name: 'AlertButton', log: () => {} },
      figma: fakeFigma(dc, cc),
    });

    expect(outcome.name).toBe('AlertButton');
    expect(outcome.codePath).toBe('src/components/AlertButton.tsx');
    expect(outcome.irPath).toBe('src/components/AlertButton.divebar.json');

    const ir = JSON.parse(
      await readFile(join(dir, 'src/components/AlertButton.divebar.json'), 'utf8')
    ) as { name: string };
    expect(ir.name).toBe('AlertButton');
    expect(await exists(join(dir, 'src/components/AlertButton.tsx'))).toBe(
      true
    );
  });

  test('translator failure writes nothing', async () => {
    await writeBaseConfig(dir);
    const malformed = { name: 'Button' };
    const cc = await loadFixture('button-code-connect.json');

    await expect(
      runPullCore({
        url: URL_BASE,
        root: dir,
        flags: { log: () => {} },
        figma: fakeFigma(malformed, cc),
      })
    ).rejects.toThrow(/^Figma MCP response did not match expected shape:/);

    expect(await exists(join(dir, 'src/components/Button.divebar.json'))).toBe(
      false
    );
    expect(await exists(join(dir, 'src/components/Button.tsx'))).toBe(false);
    expect(await exists(join(dir, 'divebar.lock'))).toBe(false);
  });

  test('logs progress in order', async () => {
    await writeBaseConfig(dir);
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const lines: string[] = [];

    await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { log: (m) => lines.push(m) },
      figma: fakeFigma(dc, cc),
    });

    expect(lines[0]).toBe('✓ Pulled Button from Figma');
    expect(lines[1]).toBe('✓ Wrote src/components/Button.divebar.json');
    expect(lines[2]).toBe('✓ Wrote src/components/Button.tsx');
    expect(lines[3]).toBe('✓ Updated divebar.lock');
  });

  test('idempotent: second call returns updated', async () => {
    await writeBaseConfig(dir);
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');

    const first = await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { log: () => {} },
      figma: fakeFigma(dc, cc),
    });
    expect(first.registered).toBe('added');

    const second = await runPullCore({
      url: URL_BASE,
      root: dir,
      flags: { log: () => {} },
      figma: fakeFigma(dc, cc),
    });
    expect(second.registered).toBe('updated');

    expect(await exists(join(dir, 'src/components/Button.divebar.json'))).toBe(
      true
    );
    expect(await exists(join(dir, 'src/components/Button.tsx'))).toBe(true);
  });
});

describe('runPull', () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-pull-prod-'));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test('missing mcp.figma config throws', async () => {
    await writeBaseConfig(dir, { withMcp: false });

    await expect(runPull(URL_BASE, { log: () => {} })).rejects.toThrow(
      'divebar.json has no mcp.figma config'
    );
  });
});
