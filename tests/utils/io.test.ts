// pins the two invariants every caller of utils/io relies on: writers create
// parent directories on demand, and writeJson terminates with a trailing
// newline so external diff tools and `cat` see a clean file end

import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readText, readJson, writeText, writeJson, exists } from '../../src/utils/io';

test('writeJson + readJson round-trips and creates parent dirs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-io-'));
  try {
    const path = join(dir, 'nested', 'deeper', 'file.json');
    expect(await exists(path)).toBe(false);

    await writeJson(path, { hello: 'world', n: 42 });
    expect(await exists(path)).toBe(true);

    const data = await readJson<{ hello: string; n: number }>(path);
    expect(data).toEqual({ hello: 'world', n: 42 });

    const raw = await readText(path);
    expect(raw.endsWith('\n')).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeText creates parent dirs and exists() returns false for missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-io-'));
  try {
    expect(await exists(join(dir, 'never.txt'))).toBe(false);
    await writeText(join(dir, 'a', 'b', 'c.txt'), 'hi');
    expect(await readText(join(dir, 'a', 'b', 'c.txt'))).toBe('hi');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
