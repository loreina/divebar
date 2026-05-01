import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLockfile, writeLockfile, setComponentLock } from '../../src/core/lockfile';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('round-trips a component lock entry', async () => {
  let lock = await readLockfile(dir);
  lock = setComponentLock(lock, 'Button', { figmaHash: 'f', codeHash: 'c', irHash: 'i' });
  await writeLockfile(dir, lock);
  expect((await readLockfile(dir)).components.Button).toEqual({
    figmaHash: 'f',
    codeHash: 'c',
    irHash: 'i',
  });
});
