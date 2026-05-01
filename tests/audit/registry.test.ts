import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules, BUILTIN_RULE_NAMES } from '../../src/audit/registry';

test('loadRules returns the five built-ins by default', async () => {
  const rules = await loadRules({ root: process.cwd(), patterns: [] });
  expect(rules.map((r) => r.name).sort()).toEqual(
    [...BUILTIN_RULE_NAMES].sort()
  );
});

test('loadRules picks up a user rule from a relative path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-rules-'));
  mkdirSync(`${dir}/.divebar/rules`, { recursive: true });
  writeFileSync(
    `${dir}/.divebar/rules/no-emoji.ts`,
    `import { defineRule } from '${process.cwd()}/src/audit/define-rule';\nexport default defineRule({ name: 'no-emoji', test: ({ node }) => /\\p{Emoji}/u.test(node.name), message: ({ node }) => 'emoji in ' + node.name });\n`
  );
  const rules = await loadRules({
    root: dir,
    patterns: ['./.divebar/rules/*.ts'],
  });
  expect(rules.map((r) => r.name)).toContain('no-emoji');
});
