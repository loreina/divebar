import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEmitters } from '../../src/emit/registry';
import { renderTokens } from '../../src/core/token-parser';
import type { TokenSet } from '../../src/core/types';

const singleMode: TokenSet = {
  tokens: {
    color: { brand: { '500': { $value: '#5B6CFF', $type: 'color' as const } } },
  },
};

const multiMode: TokenSet = {
  modes: [
    { id: 'light', name: 'light', folder: 'light' },
    { id: 'dark', name: 'dark', folder: 'dark' },
  ],
  defaultMode: 'light',
  tokens: {
    color: {
      brand: {
        '500': {
          $type: 'color' as const,
          $valuesByMode: { light: '#5B6CFF', dark: '#3F4FE6' },
        },
      },
    },
  },
};

test('loadEmitters resolves @divebar/emit-tokens-ts to the built-in', async () => {
  const emitters = await loadEmitters({
    root: process.cwd(),
    names: ['@divebar/emit-tokens-ts'],
  });
  expect(emitters).toHaveLength(1);
  expect(emitters[0]?.name).toBe('@divebar/emit-tokens-ts');
});

test('built-in @divebar/emit-tokens-ts writes one file matching renderTokens (single-mode)', async () => {
  const [emitter] = await loadEmitters({
    root: process.cwd(),
    names: ['@divebar/emit-tokens-ts'],
  });
  const files = await emitter!.emit({
    tokens: singleMode,
    modes: [],
    outDir: 'src',
  });
  expect(files).toHaveLength(1);
  expect(files[0]?.path).toBe('src/tokens.ts');
  expect(files[0]?.contents).toBe(renderTokens(singleMode));
});

test('built-in @divebar/emit-tokens-ts writes one file matching renderTokens (multi-mode)', async () => {
  const [emitter] = await loadEmitters({
    root: process.cwd(),
    names: ['@divebar/emit-tokens-ts'],
  });
  const files = await emitter!.emit({
    tokens: multiMode,
    modes: [
      { id: 'light', name: 'light', folder: 'light' },
      { id: 'dark', name: 'dark', folder: 'dark' },
    ],
    outDir: 'src',
  });
  expect(files).toHaveLength(1);
  expect(files[0]?.contents).toBe(renderTokens(multiMode));
  expect(files[0]?.contents).toContain('tokensByMode');
});

test('loadEmitters resolves a relative path to a user emitter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-emit-'));
  mkdirSync(`${dir}/local`, { recursive: true });
  writeFileSync(
    `${dir}/local/emit.ts`,
    `import { defineEmitter } from '${process.cwd()}/src/emit/define-emitter';\nexport default defineEmitter({ name: 'local-test', emit: () => [{ path: 'a.ts', contents: 'x' }] });\n`
  );
  const emitters = await loadEmitters({
    root: dir,
    names: ['./local/emit.ts'],
  });
  expect(emitters[0]?.name).toBe('local-test');
});

test('loadEmitters throws a friendly error when an emitter has no default export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-emit-'));
  mkdirSync(`${dir}/local`, { recursive: true });
  writeFileSync(`${dir}/local/empty.ts`, 'export const noop = 1;\n');
  await expect(
    loadEmitters({ root: dir, names: ['./local/empty.ts'] })
  ).rejects.toThrow(/no default export/);
});
