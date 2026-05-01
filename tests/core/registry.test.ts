import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRegistry,
  writeRegistry,
  addEntry,
  removeEntry,
  RegistrySchema,
} from '../../src/core/registry';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('returns empty registry when missing', async () => {
  const reg = await readRegistry(dir);
  expect(reg.components).toEqual({});
});

test('round-trips entries', async () => {
  let reg = await readRegistry(dir);
  reg = await addEntry(reg, { name: 'A', irPath: 'A.divebar.json' });
  reg = await addEntry(reg, { name: 'B', irPath: 'B.divebar.json' });
  await writeRegistry(dir, reg);
  const loaded = await readRegistry(dir);
  expect(loaded.components.A!.irPath).toBe('A.divebar.json');
  expect(loaded.components.B!.irPath).toBe('B.divebar.json');
  const removed = removeEntry(loaded, 'A');
  expect(removed.components.A).toBeUndefined();
  expect(removed.components.B!.irPath).toBe('B.divebar.json');
});

test('RegistrySchema accepts an mcp record with figma config', () => {
  const parsed = RegistrySchema.parse({
    mcp: { figma: { command: 'figma-mcp', args: ['--dev-mode'] } },
  });
  expect(parsed.mcp).toEqual({
    figma: { command: 'figma-mcp', args: ['--dev-mode'] },
  });
});

test('RegistrySchema rejects mcp entries missing command', () => {
  expect(() => RegistrySchema.parse({ mcp: { figma: {} } })).toThrow();
});

test('RegistrySchema parses tokens.emitters and tokens.outDir', async () => {
  const { readRegistry } = await import('../../src/core/registry');
  const dir = mkdtempSync(join(tmpdir(), 'spec-reg-'));
  await Bun.write(
    `${dir}/divebar.json`,
    JSON.stringify({
      tokens: {
        emitters: ['@divebar/emit-tokens-ts', '@picnic/emit-tokens-rn-themed'],
        outDir: 'packages/prism-tokens/src',
      },
    })
  );
  const reg = await readRegistry(dir);
  expect(reg.tokens?.emitters).toEqual([
    '@divebar/emit-tokens-ts',
    '@picnic/emit-tokens-rn-themed',
  ]);
  expect(reg.tokens?.outDir).toBe('packages/prism-tokens/src');
});
