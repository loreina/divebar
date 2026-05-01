import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEffectiveRegistry, writeRegistry, readRegistry, addEntryToWorkspace } from '../../src/core/registry';
import { regAdd, regList, regRemove } from '../../src/commands/registry';
import { runGenerate } from '../../src/commands/generate';
import { runLint } from '../../src/commands/lint';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('single-workspace configs work unchanged', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src/components',
    tokensPath: 'src/tokens.ts',
    components: { Button: { irPath: 'Button.divebar.json' } },
  });
  const eff = await loadEffectiveRegistry(dir);
  expect(eff.root).toBe(dir);
  expect(eff.framework).toBe('react');
  expect(eff.components.Button).toBeDefined();
});

test('workspace mode picks workspace by --workspace hint', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: 'packages/components',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: { Tag: { irPath: 'src/Tag/Tag.divebar.json' } },
      },
      {
        root: 'packages/icons',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: { ArrowLeft: { irPath: 'src/ArrowLeft.divebar.json' } },
      },
    ],
  });

  const eff = await loadEffectiveRegistry(dir, { workspace: 'packages/components' });
  expect(eff.root).toBe(`${dir}/packages/components`);
  expect(eff.framework).toBe('react-native');
  expect(eff.components.Tag).toBeDefined();
  expect(eff.components.ArrowLeft).toBeUndefined();
});

test('workspace mode infers workspace from codePath', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: 'packages/components',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: {},
      },
    ],
  });

  const eff = await loadEffectiveRegistry(dir, { codePath: 'packages/components/src/Tag.tsx' });
  expect(eff.root).toBe(`${dir}/packages/components`);
});

test('workspace mode infers workspace from component name', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: 'packages/components',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: { Tag: { irPath: 'src/Tag.divebar.json' } },
      },
    ],
  });

  const eff = await loadEffectiveRegistry(dir, { name: 'Tag' });
  expect(eff.root).toBe(`${dir}/packages/components`);
});

test('throws when workspace cannot be determined', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: 'packages/components',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: {},
      },
    ],
  });

  await expect(loadEffectiveRegistry(dir)).rejects.toThrow('--workspace');
});

test('addEntryToWorkspace adds to the correct workspace', async () => {
  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: 'packages/components',
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: {},
      },
    ],
  });

  await addEntryToWorkspace(dir, 'packages/components', { name: 'Tag', irPath: 'src/Tag.divebar.json' });

  const reg = await readRegistry(dir);
  expect(reg.workspaces![0]!.components.Tag).toBeDefined();
  expect(reg.workspaces![0]!.components.Tag!.irPath).toBe('src/Tag.divebar.json');
});

test('end-to-end: regAdd + regList + generate through workspace mode', async () => {
  const wsRoot = 'packages/ui';
  mkdirSync(join(dir, wsRoot, 'src'), { recursive: true });

  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: wsRoot,
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: {},
      },
    ],
  });

  const ir = {
    name: 'Badge',
    codePath: './src/Badge.tsx',
    variants: { size: ['sm', 'lg'] },
    slots: [],
    styles: [{ when: {}, bindings: { paddingX: 'spacing.sm' } }],
    semantics: {},
  };
  const irPath = 'src/Badge.divebar.json';
  await Bun.write(join(dir, wsRoot, irPath), JSON.stringify(ir));

  const tokenSet = { tokens: { spacing: { sm: { $type: 'number', $value: 4 } } } };
  await Bun.write(join(dir, wsRoot, 'src/tokens.divebar.json'), JSON.stringify(tokenSet));

  await regAdd({ name: 'Badge', irPath, workspace: wsRoot }, dir);

  const listAll = await regList(dir);
  expect(listAll).toContain(`[${wsRoot}]`);
  expect(listAll).toContain('Badge');

  const listScoped = await regList(dir, wsRoot);
  expect(listScoped).toContain('Badge');
  expect(listScoped).not.toContain(`[${wsRoot}]`);

  const codePath = await runGenerate(join(dir, wsRoot, irPath), dir, wsRoot);
  expect(codePath).toBe('./src/Badge.tsx');

  const generated = await Bun.file(join(dir, wsRoot, 'src/Badge.tsx')).text();
  expect(generated).toContain('StyleSheet');

  await regRemove('Badge', dir, wsRoot);
  const afterRemove = await regList(dir, wsRoot);
  expect(afterRemove).toBe('');
});

test('end-to-end: lint through workspace mode', async () => {
  const wsRoot = 'packages/core';
  mkdirSync(join(dir, wsRoot, 'src'), { recursive: true });

  await writeRegistry(dir, {
    version: '1',
    framework: 'react',
    styling: 'styled-components',
    outputDir: 'src',
    tokensPath: 'src/tokens.ts',
    components: {},
    workspaces: [
      {
        root: wsRoot,
        framework: 'react-native',
        styling: 'stylesheet',
        outputDir: 'src',
        tokensPath: 'src/tokens.ts',
        components: { Tag: { irPath: 'src/Tag.divebar.json' } },
      },
    ],
  });

  const ir = {
    name: 'Tag',
    codePath: './src/Tag.tsx',
    variants: { color: ['red', 'blue'] },
    slots: [],
    styles: [
      { when: { color: 'red' }, bindings: { background: 'color.red' } },
      { when: { color: 'blue' }, bindings: { background: 'color.blue' } },
    ],
    semantics: {},
  };
  await Bun.write(join(dir, wsRoot, 'src/Tag.divebar.json'), JSON.stringify(ir));

  const tokenSet = {
    tokens: {
      color: {
        red: { $type: 'color', $value: '#f00' },
        blue: { $type: 'color', $value: '#00f' },
      },
    },
  };
  await Bun.write(join(dir, wsRoot, 'src/tokens.divebar.json'), JSON.stringify(tokenSet));

  const [report] = await runLint('Tag', dir, wsRoot);
  expect(report!.findings).toEqual([]);
});
