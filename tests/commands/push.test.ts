import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPushCore, runPush } from '../../src/commands/push';
import type { FigmaMcpClient } from '../../src/adapters/figma/client';
import { ButtonIR, ButtonTokens } from '../fixtures/button';
import { canonicalize } from '../../src/utils/canonicalize';

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

async function setupProject(
  dir: string,
  opts?: { withConfig?: boolean; withMcp?: boolean }
): Promise<string> {
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'src/Button.tsx'),
    'export const Button = () => null;\n'
  );
  await writeFile(
    join(dir, 'src/Button.divebar.json'),
    JSON.stringify(ButtonIR, null, 2) + '\n'
  );
  await writeFile(
    join(dir, 'src/tokens.divebar.json'),
    canonicalize(ButtonTokens) + '\n'
  );
  if (opts?.withConfig) {
    const cfg: Record<string, unknown> = {
      version: '1',
      framework: 'react',
      styling: 'styled-components',
      outputDir: 'src/components',
      tokensPath: 'src/tokens.ts',
      components: {},
    };
    if (opts.withMcp) {
      cfg['mcp'] = { figma: { command: 'figma-mcp' } };
    }
    await writeFile(
      join(dir, 'divebar.json'),
      JSON.stringify(cfg, null, 2) + '\n'
    );
  }
  return join(dir, 'src/Button.tsx');
}

describe('runPushCore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-push-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('script-only with figma=null returns the script without sending', async () => {
    const file = await setupProject(dir);

    const outcome = await runPushCore({
      file,
      root: dir,
      flags: { scriptOnly: true, log: () => {} },
      figma: null,
    });

    expect(outcome.status).toBe('script-only');
    expect(outcome.name).toBe('Button');
    expect(outcome.script.length).toBeGreaterThan(0);
    expect(outcome.script).toContain('Button');
    expect(outcome.script).toContain('createComponent');
  });

  test('script-only short-circuits even when figma is present', async () => {
    const file = await setupProject(dir);
    let calls = 0;
    const figma = fakeFigma({
      onUseFigma: () => {
        calls += 1;
        return null;
      },
    });

    const outcome = await runPushCore({
      file,
      root: dir,
      flags: { scriptOnly: true, log: () => {} },
      figma,
    });

    expect(outcome.status).toBe('script-only');
    expect(calls).toBe(0);
  });

  test('MCP success returns sent and forwards the script', async () => {
    const file = await setupProject(dir);
    const seen: string[] = [];
    const figma = fakeFigma({
      onUseFigma: (s) => {
        seen.push(s);
        return null;
      },
    });

    const outcome = await runPushCore({
      file,
      root: dir,
      flags: { log: () => {} },
      figma,
    });

    expect(outcome.status).toBe('sent');
    expect(outcome.name).toBe('Button');
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(outcome.script);
  });

  test('MCP failure returns fallback with script and error preserved', async () => {
    const file = await setupProject(dir);
    const figma = fakeFigma({
      onUseFigma: () => {
        throw new Error('Figma plugin not running');
      },
    });

    const outcome = await runPushCore({
      file,
      root: dir,
      flags: { log: () => {} },
      figma,
    });

    expect(outcome.status).toBe('fallback');
    expect(outcome.error).toBe('Figma plugin not running');
    expect(outcome.script.length).toBeGreaterThan(0);
    expect(outcome.name).toBe('Button');
  });

  test('figma=null defaults to script-only', async () => {
    const file = await setupProject(dir);

    const outcome = await runPushCore({
      file,
      root: dir,
      flags: { log: () => {} },
      figma: null,
    });

    expect(outcome.status).toBe('script-only');
    expect(outcome.name).toBe('Button');
  });

  test('log sink only receives the success line on sent', async () => {
    const file = await setupProject(dir);

    const sentLines: string[] = [];
    const sentOutcome = await runPushCore({
      file,
      root: dir,
      flags: { log: (m) => sentLines.push(m) },
      figma: fakeFigma({}),
    });
    expect(sentOutcome.status).toBe('sent');
    expect(sentLines).toEqual(['✓ Pushed Button to Figma']);

    const fbLines: string[] = [];
    const fbOutcome = await runPushCore({
      file,
      root: dir,
      flags: { log: (m) => fbLines.push(m) },
      figma: fakeFigma({
        onUseFigma: () => {
          throw new Error('boom');
        },
      }),
    });
    expect(fbOutcome.status).toBe('fallback');
    expect(fbLines).toEqual([]);

    const soLines: string[] = [];
    const soOutcome = await runPushCore({
      file,
      root: dir,
      flags: { scriptOnly: true, log: (m) => soLines.push(m) },
      figma: null,
    });
    expect(soOutcome.status).toBe('script-only');
    expect(soLines).toEqual([]);
  });
});

describe('runPush', () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-push-prod-'));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    try {
      process.chdir(prevCwd);
    } catch {
      // best-effort restore
    }
    await rm(dir, { recursive: true, force: true });
  });

  test('missing mcp.figma config: throws without scriptOnly, succeeds with scriptOnly', async () => {
    await setupProject(dir, { withConfig: true });

    await expect(runPush('src/Button.tsx', { log: () => {} })).rejects.toThrow(
      'divebar.json has no mcp.figma config'
    );

    const outcome = await runPush('src/Button.tsx', {
      scriptOnly: true,
      log: () => {},
    });
    expect(outcome.status).toBe('script-only');
    expect(outcome.name).toBe('Button');
  });
});
