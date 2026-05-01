import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInspect } from '../../src/commands/inspect';
import { ButtonIR } from '../fixtures/button';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('reads IR from .divebar.json sidecar', async () => {
  const irPath = `${dir}/Button.divebar.json`;
  await Bun.write(irPath, JSON.stringify(ButtonIR));
  const codePath = `${dir}/Button.tsx`;
  await Bun.write(codePath, '// placeholder');

  const out = JSON.parse(await runInspect(codePath, dir));
  expect(out.name).toBe('Button');
  expect(out.codePath).toBe(codePath);
  expect(out.variants).toEqual(ButtonIR.variants);
});

test('throws when no .divebar.json sidecar exists', async () => {
  const codePath = `${dir}/Missing.tsx`;
  await Bun.write(codePath, '// placeholder');
  await expect(runInspect(codePath, dir)).rejects.toThrow('.divebar.json');
});
