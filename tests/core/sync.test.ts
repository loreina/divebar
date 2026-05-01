import { test, expect } from 'bun:test';
import { decideSync } from '../../src/core/sync';

const last = { figmaHash: 'F', codeHash: 'C', irHash: 'I' };

test('clean — no action', () => {
  expect(decideSync(last, 'F', 'C')).toEqual({ kind: 'noop' });
});

test('figma drift — render code', () => {
  expect(decideSync(last, 'F2', 'C')).toEqual({ kind: 'render-code' });
});

test('code drift — render figma', () => {
  expect(decideSync(last, 'F', 'C2')).toEqual({ kind: 'render-figma' });
});

test('both drift — conflict', () => {
  expect(decideSync(last, 'F2', 'C2')).toEqual({ kind: 'conflict' });
});

test('first sync (no last) — render-both', () => {
  expect(decideSync(undefined, 'F', 'C')).toEqual({ kind: 'render-both' });
});
