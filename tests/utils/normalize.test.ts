import { test, expect } from 'bun:test';
import { normalizeTokenRef, normalizePropName, safePropName } from '../../src/utils/normalize';

test('normalizeTokenRef: slash path to camelCase', () => {
  expect(normalizeTokenRef('usage/color/background/default')).toBe('usageColorBackgroundDefault');
});

test('normalizeTokenRef: dash path to camelCase', () => {
  expect(normalizeTokenRef('base/color/neutral-0')).toBe('baseColorNeutral0');
});

test('normalizeTokenRef: camelCase unchanged', () => {
  expect(normalizeTokenRef('themeColorBackgroundDefault')).toBe('themeColorBackgroundDefault');
});

test('normalizeTokenRef: dot-path unchanged', () => {
  expect(normalizeTokenRef('color.brand.500')).toBe('color.brand.500');
});

test('normalizePropName: Lead. Content -> leadContent', () => {
  expect(normalizePropName('Lead. Content')).toBe('leadContent');
});

test('normalizePropName: Size -> size', () => {
  expect(normalizePropName('Size')).toBe('size');
});

test('normalizePropName: Has Icon? -> hasIcon', () => {
  expect(normalizePropName('Has Icon?')).toBe('hasIcon');
});

test('safePropName: style -> variant', () => {
  expect(safePropName('style')).toBe('variant');
});

test('safePropName: className -> variant', () => {
  expect(safePropName('className')).toBe('variant');
});

test('safePropName: normal name unchanged', () => {
  expect(safePropName('size')).toBe('size');
});
