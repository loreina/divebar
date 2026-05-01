import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { regAdd, regList, regRemove } from '../../src/commands/registry';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('CRUD: add, list, remove', async () => {
  await regAdd({ name: 'Button', irPath: 'Button.divebar.json' }, dir);
  expect(await regList(dir)).toContain('Button');
  await regRemove('Button', dir);
  expect(await regList(dir)).toBe('');
});
