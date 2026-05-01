import { test, expect } from 'bun:test';
import rule from '../../../src/audit/rules/non-library-instances';
import type { NormalizedFigmaNode } from '../../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

const KNOWN_KEYS = new Set(['tag-key-abc', 'chip-key-def']);

test('flags INSTANCE nodes whose componentKey is not in the mirror', () => {
  const ctx = {
    node: node({
      id: '2:4',
      name: 'card',
      type: 'INSTANCE',
      componentKey: 'card-not-in-mirror',
    }),
    state: { libraryKeys: KNOWN_KEYS },
  };
  expect(rule.test(ctx)).toBe(true);
  expect(rule.message(ctx)).toContain('card');
  expect(rule.message(ctx)).toContain('not in');
});

test('does not flag known library keys', () => {
  const ctx = {
    node: node({
      id: '2:1',
      name: 'Tag',
      type: 'INSTANCE',
      componentKey: 'tag-key-abc',
    }),
    state: { libraryKeys: KNOWN_KEYS },
  };
  expect(rule.test(ctx)).toBe(false);
});

test('does not flag non-INSTANCE nodes', () => {
  const ctx = {
    node: node({
      id: '2:2',
      name: 'Banner',
      type: 'FRAME',
      componentKey: 'whatever',
    }),
    state: { libraryKeys: KNOWN_KEYS },
  };
  expect(rule.test(ctx)).toBe(false);
});
