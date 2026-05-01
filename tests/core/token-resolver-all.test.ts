import { test, expect } from 'bun:test';
import { resolveAllTokenRefs } from '../../src/core/token-resolver';
import { ButtonTokens } from '../fixtures/button';

test('resolves all bindings to concrete values', () => {
  const result = resolveAllTokenRefs(
    { background: 'color.brand.500', foreground: 'color.neutral.0' },
    ButtonTokens,
  );
  expect(result).toEqual({ background: '#5B6CFF', foreground: '#FFFFFF' });
});

test('resolves numeric tokens as strings', () => {
  const result = resolveAllTokenRefs({ gap: 'size.sm' }, ButtonTokens);
  expect(result).toEqual({ gap: '8' });
});

test('throws on missing ref', () => {
  expect(() =>
    resolveAllTokenRefs({ background: 'color.missing.ref' }, ButtonTokens),
  ).toThrow();
});
