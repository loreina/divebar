import { test, expect } from 'bun:test';
import rule from '../../../src/audit/rules/hardcoded-fills';
import type { NormalizedFigmaNode } from '../../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

test('flags solid fills that have no boundVariableId', () => {
  const ctx = {
    node: node({
      id: '2:2',
      name: 'Banner',
      type: 'FRAME',
      fills: [{ type: 'SOLID', color: { hex: '#FF6B35' } }],
    }),
    state: {},
  };
  expect(rule.test(ctx)).toBe(true);
  expect(rule.message(ctx)).toContain('#FF6B35');
});

test('does not flag fills with a boundVariableId', () => {
  const ctx = {
    node: node({
      id: '3:1',
      name: 'OK',
      type: 'FRAME',
      fills: [
        {
          type: 'SOLID',
          color: { hex: '#5B6CFF' },
          boundVariableId: 'VariableID:1:1',
        },
      ],
    }),
    state: {},
  };
  expect(rule.test(ctx)).toBe(false);
});

test('does not flag nodes with no fills', () => {
  const ctx = { node: node({ id: 'x', name: 'X', type: 'FRAME' }), state: {} };
  expect(rule.test(ctx)).toBe(false);
});
