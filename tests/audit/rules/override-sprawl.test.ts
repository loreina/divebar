import { test, expect } from 'bun:test';
import rule from '../../../src/audit/rules/override-sprawl';
import type {
  NormalizedFigmaNode,
  RuleContext,
} from '../../../src/audit/define-rule';

function node(
  partial: Partial<NormalizedFigmaNode> & { id: string; name: string }
): NormalizedFigmaNode {
  return { type: 'NODE', ...partial };
}

function pushCtx(state: Record<string, any>, n: NormalizedFigmaNode) {
  const ctx: RuleContext = { node: n, state };
  rule.test(ctx);
}

test('finalize emits one finding per (component, key) overridden 3+ times', () => {
  const state: Record<string, any> = {};
  for (let i = 0; i < 23; i++) {
    pushCtx(
      state,
      node({
        id: `n:${i}`,
        name: 'Tag',
        type: 'INSTANCE',
        componentKey: 'tag-key-abc',
        overrides: { label: `value-${i}` },
      })
    );
  }
  const findings = rule.finalize!(state);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Tag.label overridden 23 times');
});

test('does not emit a finding when overrides happen fewer than 3 times', () => {
  const state: Record<string, any> = {};
  for (let i = 0; i < 2; i++) {
    pushCtx(
      state,
      node({
        id: `n:${i}`,
        name: 'Tag',
        type: 'INSTANCE',
        componentKey: 'tag-key-abc',
        overrides: { label: `value-${i}` },
      })
    );
  }
  expect(rule.finalize!(state)).toEqual([]);
});
