// covers the figma-variable name normalization pipeline: the camel/dot/
// preserve formats, optional namePrefix, registry config inheritance + cli
// override precedence, and the removal-error path for --from figma-variables

import { test, expect } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokensImport } from '../../src/commands/tokens';

const fixture = {
  modes: [{ modeId: '1:0', name: 'Light' }],
  variables: [
    {
      name: 'base/color/amber/0',
      resolvedType: 'COLOR' as const,
      valuesByMode: { '1:0': '#FFF7ED' },
    },
    {
      name: 'usage/color/background/default',
      resolvedType: 'COLOR' as const,
      valuesByMode: { '1:0': '#FFFFFF' },
    },
  ],
};

test('--from figma --fixture with nameFormat=camel produces camelCase keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-'));
  await writeFile(join(dir, 'fixture.json'), JSON.stringify(fixture));

  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    nameFormat: 'camel',
    root: dir,
  });

  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('baseColorAmber0');
  expect(keys).toContain('usageColorBackgroundDefault');
  expect(keys).not.toContain('base/color/amber/0');
});

test('nameFormat=preserve keeps slash paths verbatim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-preserve-'));
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    nameFormat: 'preserve',
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('base/color/amber/0');
  expect(keys).toContain('usage/color/background/default');
});

test('nameFormat=dot emits dot-paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-dot-'));
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    nameFormat: 'dot',
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('base.color.amber.0');
  expect(keys).toContain('usage.color.background.default');
});

test("namePrefix='picnic' produces picnicBaseColorAmber0 under nameFormat=camel", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-prefix-'));
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    nameFormat: 'camel',
    namePrefix: 'picnic',
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('picnicBaseColorAmber0');
  expect(keys).toContain('picnicUsageColorBackgroundDefault');
});

test('missing nameFormat defaults to preserve (back-compat)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-default-'));
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('base/color/amber/0');
});

test('reads nameFormat from registry tokens config when no CLI flag is passed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-reg-'));
  await writeFile(
    join(dir, 'divebar.json'),
    JSON.stringify({
      tokens: { emitters: [], nameFormat: 'camel' },
    })
  );
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('baseColorAmber0');
});

test('CLI nameFormat overrides registry config when both are present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-override-'));
  await writeFile(
    join(dir, 'divebar.json'),
    JSON.stringify({
      tokens: { emitters: [], nameFormat: 'camel' },
    })
  );
  const ts = await tokensImport({
    from: 'figma',
    fileKey: 'KEY',
    figma: { getVariableDefs: async () => fixture },
    nameFormat: 'preserve',
    root: dir,
  });
  const keys = Object.keys(ts.tokens);
  expect(keys).toContain('base/color/amber/0');
  expect(keys).not.toContain('baseColorAmber0');
});

test('--from figma-variables errors with a clear "use --from figma --fixture" message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-norm-removed-'));
  const fixturePath = join(dir, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(fixture));

  const cli = `${process.cwd()}/src/cli.ts`;
  const r = Bun.spawnSync({
    cmd: [
      'bun',
      cli,
      'tokens',
      'import',
      '--from',
      'figma-variables',
      fixturePath,
    ],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(r.exitCode).not.toBe(0);
  const stderr = r.stderr.toString();
  expect(stderr).toContain('--from figma-variables is removed');
  expect(stderr).toContain('use --from figma --fixture');
});
