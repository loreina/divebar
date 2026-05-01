import { test, expect } from 'bun:test';
import rule from '../../../src/audit/rules/detached-instances';
import type { NormalizedFigmaNode } from '../../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

const KNOWN_LIBRARY_NAMES = new Set(['Chip', 'Tag', 'Card', 'Button']);

test('flags FRAME nodes whose name matches a known library component', () => {
  const ctx = {
    node: node({ id: '2:3', name: 'Chip', type: 'FRAME' }),
    state: { libraryNames: KNOWN_LIBRARY_NAMES },
  };
  expect(rule.test(ctx)).toBe(true);
  expect(rule.message(ctx)).toContain('FRAME, not an INSTANCE');
});

test('does not flag INSTANCE nodes', () => {
  const ctx = {
    node: node({ id: '2:1', name: 'Chip', type: 'INSTANCE' }),
    state: { libraryNames: KNOWN_LIBRARY_NAMES },
  };
  expect(rule.test(ctx)).toBe(false);
});

test('does not flag FRAME nodes whose name is not in the library', () => {
  const ctx = {
    node: node({ id: '2:2', name: 'Banner', type: 'FRAME' }),
    state: { libraryNames: KNOWN_LIBRARY_NAMES },
  };
  expect(rule.test(ctx)).toBe(false);
});
