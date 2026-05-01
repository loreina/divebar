import { test, expect } from 'bun:test';
import { enumerateVariants, matchedBindings } from '../../src/core/variants';
import type { ComponentDefinition } from '../../src/core/types';

// --- enumerateVariants ---

test('empty axes produces a single empty selector', () => {
  expect(enumerateVariants({})).toEqual([]);
});

test('single axis produces one selector per value', () => {
  const result = enumerateVariants({ size: ['sm', 'md', 'lg'] });
  expect(result).toEqual([{ size: 'sm' }, { size: 'md' }, { size: 'lg' }]);
});

test('two axes produce the cartesian product', () => {
  const result = enumerateVariants({
    kind: ['primary', 'secondary'],
    size: ['sm', 'lg'],
  });
  expect(result).toEqual([
    { kind: 'primary', size: 'sm' },
    { kind: 'primary', size: 'lg' },
    { kind: 'secondary', size: 'sm' },
    { kind: 'secondary', size: 'lg' },
  ]);
});

test('three axes produce the full cartesian product', () => {
  const result = enumerateVariants({
    a: ['1', '2'],
    b: ['x', 'y'],
    c: ['!'],
  });
  expect(result).toHaveLength(4);
  expect(result).toContainEqual({ a: '1', b: 'x', c: '!' });
  expect(result).toContainEqual({ a: '2', b: 'y', c: '!' });
});

// --- matchedBindings ---

const ir: ComponentDefinition = {
  name: 'Test',
  codePath: '',
  variants: { kind: ['a', 'b'], size: ['sm', 'lg'] },
  slots: [],
  styles: [
    { when: { kind: 'a' }, bindings: { background: 'tok.bg' } },
    { when: { kind: 'b' }, bindings: { background: 'tok.fg' } },
    { when: { kind: 'a', size: 'sm' }, bindings: { foreground: 'tok.sm' } },
  ],
  semantics: {},
};

test('returns empty when no rules match', () => {
  expect(matchedBindings(ir, { kind: 'b', size: 'sm' })).toEqual({
    background: 'tok.fg',
  });
});

test('matches a partial selector', () => {
  const result = matchedBindings(ir, { kind: 'a', size: 'lg' });
  expect(result).toEqual({ background: 'tok.bg' });
});

test('merges overlapping rules for a full match', () => {
  const result = matchedBindings(ir, { kind: 'a', size: 'sm' });
  expect(result).toEqual({ background: 'tok.bg', foreground: 'tok.sm' });
});
