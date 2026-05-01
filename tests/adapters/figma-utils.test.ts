import { test, expect } from 'bun:test';
import { tokenRefToVariablePath } from '../../src/adapters/figma';

test('converts dot-path to slash-separated Figma Variable path', () => {
  expect(tokenRefToVariablePath('color.brand.500')).toBe('color/brand/500');
});

test('single segment stays unchanged', () => {
  expect(tokenRefToVariablePath('opacity')).toBe('opacity');
});

test('handles deeply nested paths', () => {
  expect(tokenRefToVariablePath('a.b.c.d.e')).toBe('a/b/c/d/e');
});
