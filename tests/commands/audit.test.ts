import { test, expect } from 'bun:test';
import { runAudit } from '../../src/commands/audit';

const fixture = await Bun.file(
  'tests/fixtures/figma-frame-with-issues.json'
).json();

function fakeFigma() {
  return {
    getMetadata: async ({ nodeId }: { fileKey: string; nodeId?: string }) =>
      !nodeId || nodeId === '1:1' ? [fixture] : [],
  };
}

test('runAudit reports findings for every built-in rule against the fixture frame', async () => {
  const findings = await runAudit({
    fileKey: 'F',
    rootNodeId: '1:1',
    figma: fakeFigma(),
    libraryNames: new Set(['Chip', 'Tag', 'Card']),
    libraryKeys: new Set(['tag-key-abc', 'chip-key-def']),
  });
  const names = new Set(findings.map((f) => f.rule));
  expect(names.has('deprecated-variants')).toBe(true);
  expect(names.has('hardcoded-fills')).toBe(true);
  expect(names.has('detached-instances')).toBe(true);
  expect(names.has('non-library-instances')).toBe(true);
  expect(names.has('override-sprawl')).toBe(true);
});

test('runAudit returns no findings against an empty frame', async () => {
  const figma = {
    getMetadata: async () => [
      { id: '1:1', name: 'Empty', type: 'FRAME', children: [] },
    ],
  };
  const findings = await runAudit({
    fileKey: 'F',
    rootNodeId: '1:1',
    figma,
    libraryNames: new Set(),
    libraryKeys: new Set(),
  });
  expect(findings).toEqual([]);
});

import { spawnSync } from 'bun';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI: divebar audit --from-figma --fixture prints all five rule prefixes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-audit-cli-'));
  const cli = `${process.cwd()}/src/cli.ts`;
  const fixturePath = `${process.cwd()}/tests/fixtures/figma-frame-with-issues.json`;
  const r = spawnSync({
    cmd: [
      'bun',
      cli,
      'audit',
      '--from-figma',
      'https://figma.com/design/F/?node-id=1-1',
      '--fixture',
      fixturePath,
      '--library-names',
      'Chip,Tag,Card',
      '--library-keys',
      'tag-key-abc,chip-key-def',
    ],
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = (r.stdout?.toString() ?? '') + (r.stderr?.toString() ?? '');
  expect(out).toContain('deprecated-variants');
  expect(out).toContain('hardcoded-fills');
  expect(out).toContain('detached-instances');
  expect(out).toContain('non-library-instances');
  expect(out).toContain('override-sprawl');
});
