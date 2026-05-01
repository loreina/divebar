import { test, expect } from 'bun:test';
import {
  defineRule,
  type NormalizedFigmaNode,
} from '../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

test('defineRule returns the rule object verbatim', () => {
  const rule = defineRule({
    name: 'no-cross-collection-aliases',
    test: (ctx) => ctx.node.name === 'bad',
    message: (ctx) => `${ctx.node.name} aliases across collections`,
  });
  expect(rule.name).toBe('no-cross-collection-aliases');
  expect(rule.test({ node: node({ id: '1', name: 'bad' }), state: {} })).toBe(
    true
  );
  expect(
    rule.message({ node: node({ id: '1', name: 'bad' }), state: {} })
  ).toBe('bad aliases across collections');
});

test('defineRule supports an optional finalize hook', () => {
  const rule = defineRule({
    name: 'overrides',
    test: () => false,
    message: () => '',
    finalize: (state) => [
      {
        rule: 'overrides',
        node: state['last'] as { id: string; name: string },
        message: 'aggregate',
      },
    ],
  });
  const findings = rule.finalize!({ last: { id: '1', name: 'X' } });
  expect(findings).toHaveLength(1);
});
