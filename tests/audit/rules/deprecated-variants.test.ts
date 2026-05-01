import { test, expect } from 'bun:test';
import rule from '../../../src/audit/rules/deprecated-variants';
import type { NormalizedFigmaNode } from '../../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

test('flags variants whose value contains "Deprecated"', () => {
  const ctx = {
    node: node({
      id: '2:1',
      name: 'Tag',
      type: 'INSTANCE',
      variantProperties: { Size: '⛔ XSmall (Deprecated)', Kind: 'Primary' },
    }),
    state: {},
  };
  expect(rule.test(ctx)).toBe(true);
  expect(rule.message(ctx)).toContain('Deprecated');
});

test('does not flag variants without "Deprecated" text', () => {
  const ctx = {
    node: node({
      id: '2:5',
      name: 'Tag',
      type: 'INSTANCE',
      variantProperties: { Size: 'Small', Kind: 'Primary' },
    }),
    state: {},
  };
  expect(rule.test(ctx)).toBe(false);
});
