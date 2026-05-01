import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, readCache, writeCache } from '../../src/core/cache';

test('cacheKey is stable across mode-list permutations', async () => {
  const a = await cacheKey({ fileKey: 'F', modes: ['light', 'dark'] });
  const b = await cacheKey({ fileKey: 'F', modes: ['dark', 'light'] });
  expect(a).toBe(b);
});

test('cacheKey changes when fileKey changes', async () => {
  const a = await cacheKey({ fileKey: 'F', modes: ['light'] });
  const b = await cacheKey({ fileKey: 'G', modes: ['light'] });
  expect(a).not.toBe(b);
});

test('writeCache then readCache returns the same payload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-cache-'));
  const path = `${dir}/.figma-cache.json`;
  const key = await cacheKey({ fileKey: 'F', modes: ['light'] });
  await writeCache(path, key, { hello: 'world' });
  const got = await readCache(path, key);
  expect(got).toEqual({ hello: 'world' });
});

test('readCache returns null on key miss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-cache-'));
  const path = `${dir}/.figma-cache.json`;
  const key = await cacheKey({ fileKey: 'F', modes: ['light'] });
  await writeCache(path, key, { hello: 'world' });
  const otherKey = await cacheKey({ fileKey: 'F', modes: ['dark'] });
  expect(await readCache(path, otherKey)).toBeNull();
});

test('readCache returns null when the file does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-cache-'));
  const path = `${dir}/.figma-cache.json`;
  const key = await cacheKey({ fileKey: 'F', modes: ['light'] });
  expect(await readCache(path, key)).toBeNull();
});
