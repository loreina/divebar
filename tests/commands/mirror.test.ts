import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'bun';
import {
  mirrorSync,
  writeMirror,
  writePerComponent,
  mirrorDiff,
} from '../../src/commands/mirror';
import type { Mirror } from '../../src/core/mirror-schema';

const fixture = await Bun.file('tests/fixtures/figma-mcp-metadata.json').json();

function fakeFigma() {
  return {
    getMetadata: async () => fixture.get_metadata,
    searchDesignSystem: async () => fixture.search_design_system,
  };
}

test('mirrorSync returns one entry per component set', async () => {
  const mirror = await mirrorSync({
    fileKey: 'yGl8SWusmYAE3QzCluFurq',
    figma: fakeFigma(),
  });
  expect(mirror).toHaveLength(2);
});

test('mirrorSync builds variantProperties from child names', async () => {
  const mirror = await mirrorSync({ fileKey: 'x', figma: fakeFigma() });
  expect(mirror[0]).toMatchObject({
    name: 'Tag',
    nodeId: '31854:163353',
    componentKey: 'tag-key-abc',
    variantProperties: {
      Size: ['Small', 'Large'],
      Kind: ['Primary', 'Secondary'],
    },
  });
});

test('mirrorSync emits null componentKey when search has no hit', async () => {
  const figma = {
    getMetadata: async () => fixture.get_metadata,
    searchDesignSystem: async () => [],
  };
  const mirror = await mirrorSync({ fileKey: 'x', figma });
  expect(mirror[0]?.componentKey).toBeNull();
});

test('mirrorSync passes children through with name and nodeId only', async () => {
  const mirror = await mirrorSync({ fileKey: 'x', figma: fakeFigma() });
  expect(mirror[1]?.children).toEqual([
    { name: 'State=Default', nodeId: '31854:200001' },
    { name: 'State=Selected', nodeId: '31854:200002' },
  ]);
});

test('writeMirror emits a single JSON file with two-space indent and trailing newline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-mirror-'));
  const out = `${dir}/mirror.json`;
  const mirror = await mirrorSync({ fileKey: 'x', figma: fakeFigma() });
  await writeMirror({ output: out, mirror });
  const written = await Bun.file(out).text();
  expect(written.endsWith('\n')).toBe(true);
  expect(JSON.parse(written)).toEqual(mirror);
});

test('writePerComponent writes <Name>.divebar.mirror.json next to each component', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-mirror-'));
  const mirror = await mirrorSync({ fileKey: 'x', figma: fakeFigma() });
  await writePerComponent({
    outputDir: dir,
    mirror,
    layout: (component) =>
      `${component.name}/${component.name}.divebar.mirror.json`,
  });

  const tag = JSON.parse(
    await Bun.file(`${dir}/Tag/Tag.divebar.mirror.json`).text()
  );
  expect(tag.name).toBe('Tag');
  expect(tag.variantProperties.Size).toEqual(['Small', 'Large']);

  const chip = JSON.parse(
    await Bun.file(`${dir}/Chip/Chip.divebar.mirror.json`).text()
  );
  expect(chip.children).toHaveLength(2);
});

test('mirrorDiff reports added, removed, and changed components', async () => {
  const previous: Mirror = [
    {
      name: 'Tag',
      nodeId: '1:1',
      componentKey: 'k',
      variantProperties: { Size: ['Small'] },
      children: [{ name: 'Size=Small', nodeId: '1:2' }],
    },
    {
      name: 'Old',
      nodeId: '9:9',
      componentKey: null,
      variantProperties: {},
      children: [],
    },
  ];
  const next: Mirror = [
    {
      name: 'Tag',
      nodeId: '1:1',
      componentKey: 'k',
      variantProperties: { Size: ['Small', 'Large'] },
      children: [
        { name: 'Size=Small', nodeId: '1:2' },
        { name: 'Size=Large', nodeId: '1:3' },
      ],
    },
    {
      name: 'New',
      nodeId: '5:5',
      componentKey: null,
      variantProperties: {},
      children: [],
    },
  ];
  const diff = mirrorDiff({ previous, next });
  expect(diff.added.map((c) => c.name)).toEqual(['New']);
  expect(diff.removed.map((c) => c.name)).toEqual(['Old']);
  expect(diff.changed.map((c) => c.name)).toEqual(['Tag']);
});

test('mirrorSync output matches the picnic-shape snapshot byte-for-byte', async () => {
  const expected = await Bun.file(
    'tests/fixtures/picnic-mirror-snapshot.json'
  ).text();
  const dir = mkdtempSync(join(tmpdir(), 'spec-mirror-'));
  const out = `${dir}/mirror.json`;
  await writeMirror({
    output: out,
    mirror: await mirrorSync({ fileKey: 'x', figma: fakeFigma() }),
  });
  expect(await Bun.file(out).text()).toBe(expected);
});

test('CLI: divebar mirror sync --file --output produces snapshot bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-cli-'));
  const out = `${dir}/mirror.json`;
  const cli = `${process.cwd()}/src/cli.ts`;
  const fixturePath = `${process.cwd()}/tests/fixtures/figma-mcp-metadata.json`;
  const result = spawnSync({
    cmd: [
      'bun',
      cli,
      'mirror',
      'sync',
      '--file',
      'x',
      '--output',
      out,
      '--fixture',
      fixturePath,
    ],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  const expected = await Bun.file(
    'tests/fixtures/picnic-mirror-snapshot.json'
  ).text();
  expect(await Bun.file(out).text()).toBe(expected);
});
