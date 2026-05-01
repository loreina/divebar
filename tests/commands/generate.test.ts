import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGenerate } from '../../src/commands/generate';
import { writeRegistry, addEntry, readRegistry } from '../../src/core/registry';
import { renderTokensSpec } from '../../src/core/token-parser';
import { ButtonIR, ButtonTokens } from '../fixtures/button';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

test('generates a code file from an IR', async () => {
  await writeRegistry(
    dir,
    await addEntry(await readRegistry(dir), {
      name: 'Button',
      irPath: 'Button.divebar.json',
    })
  );
  await Bun.write(`${dir}/src/tokens.divebar.json`, renderTokensSpec(ButtonTokens));
  await Bun.write(`${dir}/ir.json`, JSON.stringify({ ...ButtonIR, codePath: 'Button.tsx' }));

  await runGenerate(`${dir}/ir.json`, dir);
  const code = await Bun.file(`${dir}/Button.tsx`).text();
  expect(code).toContain('export function Button');
  expect(code).not.toContain('@divebar');
});
