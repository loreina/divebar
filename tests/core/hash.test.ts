import { test, expect } from 'bun:test';
import { hashIR } from '../../src/core/hash';

const A = {
  divebarVersion: 1,
  name: 'B',
  figmaNodeId: '1:1',
  codePath: 'B.tsx',
  variants: { kind: ['a', 'b'] },
  slots: ['c'],
  styles: [{ when: { kind: 'a' }, bindings: { background: 'color.x' } }],
  semantics: { role: 'button' },
};

test('hash is stable across key order', async () => {
  const reordered = { ...A, semantics: A.semantics, slots: A.slots, name: A.name };
  expect(await hashIR(A)).toBe(await hashIR(reordered));
});

test('hash ignores $schema field', async () => {
  expect(await hashIR(A)).toBe(await hashIR({ ...A, $schema: 'https://x' } as any));
});

test('hash differs when content differs', async () => {
  expect(await hashIR(A)).not.toBe(await hashIR({ ...A, name: 'C' }));
});
