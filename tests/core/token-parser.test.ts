import { test, expect } from 'bun:test';
import { renderTokens, renderTokensSpec, parseTokensSpec } from '../../src/core/token-parser';

const ts = {
  tokens: { color: { brand: { '500': { $value: '#5B6CFF', $type: 'color' as const } } } },
};

test('round-trips a token set via .divebar.json', () => {
  const spec = renderTokensSpec(ts);
  expect(parseTokensSpec(spec)).toEqual(ts);
});

test('renderTokens produces valid single-mode TypeScript', () => {
  const code = renderTokens(ts);
  expect(code).toContain('export const tokens');
  expect(code).toContain('#5B6CFF');
  expect(code).not.toContain('@divebar-tokens');
});

test('renderTokens produces multi-mode output', () => {
  const multiMode = {
    modes: [
      { id: 'light', name: 'light', folder: 'light' },
      { id: 'dark', name: 'dark', folder: 'dark' },
    ],
    defaultMode: 'light',
    tokens: {
      bg: {
        $type: 'color' as const,
        $valuesByMode: { light: '#FFFFFF', dark: '#000000' },
      },
    },
  };
  const code = renderTokens(multiMode);
  expect(code).toContain('tokensByMode');
  expect(code).toContain('#FFFFFF');
  expect(code).toContain('#000000');
  expect(code).toContain('ThemeMode');
});

test('preserves designSource and designName in .divebar.json round-trip', () => {
  const withDesign = {
    tokens: {
      bg: {
        $type: 'color' as const,
        $value: '#FFF',
        designSource: { tool: 'figma', variableId: 'VariableID:1:2' },
        designName: 'usage/color/bg',
      },
    },
  };
  const spec = renderTokensSpec(withDesign);
  const parsed = parseTokensSpec(spec);
  expect((parsed.tokens.bg as any).designSource.variableId).toBe('VariableID:1:2');
  expect((parsed.tokens.bg as any).designName).toBe('usage/color/bg');
});
