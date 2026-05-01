import { test, expect } from 'bun:test';
import { resolveTokenRef } from '../../src/core/token-resolver';

const ts = {
  tokens: { color: { brand: { '500': { $value: '#5B6CFF', $type: 'color' as const } } } },
};

test('resolves nested ref', () => {
  expect(resolveTokenRef(ts, 'color.brand.500')).toBe('#5B6CFF');
});

test('throws on missing ref', () => {
  expect(() => resolveTokenRef(ts, 'color.missing.x')).toThrow();
});

test('resolves $valuesByMode with explicit mode', () => {
  const multiMode = {
    modes: [
      { id: 'light', name: 'light', folder: 'light' },
      { id: 'dark', name: 'dark', folder: 'dark' },
    ],
    defaultMode: 'light',
    tokens: { bg: { $type: 'color' as const, $valuesByMode: { light: '#FFF', dark: '#000' } } },
  };
  expect(resolveTokenRef(multiMode, 'bg', 'dark')).toBe('#000');
});

test('resolves $valuesByMode with defaultMode', () => {
  const multiMode = {
    modes: [
      { id: 'light', name: 'light', folder: 'light' },
      { id: 'dark', name: 'dark', folder: 'dark' },
    ],
    defaultMode: 'light',
    tokens: { bg: { $type: 'color' as const, $valuesByMode: { light: '#FFF', dark: '#000' } } },
  };
  expect(resolveTokenRef(multiMode, 'bg')).toBe('#FFF');
});

test('resolves $alias', () => {
  const withAlias = {
    tokens: {
      base: { $type: 'color' as const, $value: '#FFF' },
      alias: { $type: 'color' as const, $value: { $alias: 'base' } },
    },
  };
  expect(resolveTokenRef(withAlias, 'alias')).toBe('#FFF');
});
