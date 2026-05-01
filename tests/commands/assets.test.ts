// covers the asset-manifest shape that downstream icon catalogs depend on
// (fileKey, generatedAt, assets[]) and the optional exportSvg side-effect
// of writing one .svg per component next to assets.json

import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetsSync } from '../../src/commands/assets';

const fakeFigma = {
  getMetadata: async () => [
    {
      id: '1:1',
      name: 'icon-add',
      children: [{ id: '1:2', name: 'Default' }],
    },
    {
      id: '1:3',
      name: 'icon-close',
      children: [{ id: '1:4', name: 'Default' }],
    },
  ],
  searchDesignSystem: async () => [
    { nodeId: '1:1', key: 'icon-add-key' },
    { nodeId: '1:3', key: 'icon-close-key' },
  ],
};

test('assets sync writes a manifest and invokes exportSvg per component', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-assets-'));
  const svgsExported: string[] = [];

  const manifest = await assetsSync({
    fileKey: 'KEY',
    figma: fakeFigma,
    outputDir: dir,
    exportSvg: async (entry) => {
      svgsExported.push(entry.name);
      return `<svg data-name="${entry.name}"/>`;
    },
  });

  expect(manifest.assets).toHaveLength(2);
  expect(manifest.assets.map((a) => a.name).sort()).toEqual([
    'icon-add',
    'icon-close',
  ]);

  const onDisk = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
  expect(onDisk.assets).toHaveLength(2);

  expect(svgsExported.sort()).toEqual(['icon-add', 'icon-close']);
  const svg = await readFile(join(dir, 'icon-add.svg'), 'utf8');
  expect(svg).toBe('<svg data-name="icon-add"/>');
});

test('without exportSvg, only the manifest is written; no .svg files appear', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-assets-'));

  const manifest = await assetsSync({
    fileKey: 'KEY',
    figma: fakeFigma,
    outputDir: dir,
  });

  expect(manifest.assets).toHaveLength(2);

  const entries = await readdir(dir);
  expect(entries).toEqual(['assets.json']);
  expect(entries.some((e) => e.endsWith('.svg'))).toBe(false);
});

test('manifest schema is stable: { fileKey, generatedAt, assets: [{ name, nodeId, componentKey }] }', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-assets-'));

  const manifest = await assetsSync({
    fileKey: 'KEY',
    figma: fakeFigma,
    outputDir: dir,
  });

  expect(Object.keys(manifest).sort()).toEqual([
    'assets',
    'fileKey',
    'generatedAt',
  ]);
  expect(manifest.fileKey).toBe('KEY');
  expect(typeof manifest.generatedAt).toBe('string');
  expect(() => new Date(manifest.generatedAt).toISOString()).not.toThrow();

  for (const asset of manifest.assets) {
    expect(Object.keys(asset).sort()).toEqual([
      'componentKey',
      'name',
      'nodeId',
    ]);
  }

  const onDisk = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
  expect(onDisk).toEqual(manifest);
});
