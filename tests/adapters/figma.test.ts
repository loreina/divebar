import { test, expect } from 'bun:test';
import { figmaAdapter } from '../../src/adapters/figma';
import { ButtonIR, ButtonTokens } from '../fixtures/button';

test('emits a use_figma script with component name and designSource', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  expect(out).toContain('"Button"');
  expect(out).toContain('123:456');
  expect(out).toContain('createComponent');
});

test('renderComponent emits variableBindings with slash-separated token paths', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  expect(out).toContain('color/brand/500');
  expect(out).toContain('color/neutral/0');
});

test('renderComponent omits variableBindings for variants without style rules', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  const bindingsMatch = out.match(/const variableBindings = (\{[\s\S]*?\});/);
  expect(bindingsMatch).not.toBeNull();
  const bindings = JSON.parse(bindingsMatch![1]!);
  const hasBindingsForTertiary = Object.keys(bindings).some((k) => k.includes('kind=tertiary'));
  expect(hasBindingsForTertiary).toBe(false);
});

test('renderComponent passes variableBindings to createComponent call', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  expect(out).toContain('variableBindings');
  expect(out).toContain('createComponent');
});

test('renderComponent variants no longer contain fills', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  expect(out).not.toContain('"fills"');
});

test('renderTokens emits upsertVariables with the token tree', () => {
  const out = figmaAdapter.renderTokens(ButtonTokens);
  expect(out).toContain('upsertVariables');
  expect(out).toContain('#5B6CFF');
});

test('renderComponent variant count matches cartesian product', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens);
  const matches = out.match(/"name":/g);
  expect(matches?.length).toBe(3 * 3);
});

test('uses designName from variantMappings in variant names', () => {
  const irWithMappings = {
    ...ButtonIR,
    variantMappings: {
      kind: {
        designName: 'Kind',
        values: [
          { code: 'primary', designName: 'Primary' },
          { code: 'secondary', designName: 'Secondary' },
          { code: 'tertiary', designName: 'Tertiary' },
        ],
      },
    },
  };
  const out = figmaAdapter.renderComponent(irWithMappings, ButtonTokens);
  expect(out).toContain('Kind=Primary');
  expect(out).not.toContain('kind=primary');
});

test('excludeWhen filters out matching variant combos', () => {
  const irWithExclude = {
    ...ButtonIR,
    excludeWhen: [{ kind: 'tertiary' }],
  };
  const out = figmaAdapter.renderComponent(irWithExclude, ButtonTokens);
  const matches = out.match(/"name":/g);
  expect(matches?.length).toBe(2 * 3);
});

test('uses token designName when present (overrides separator conversion)', () => {
  const tokensWithDesignNames = {
    tokens: {
      color: {
        brand: {
          '500': {
            $value: '#5B6CFF',
            $type: 'color' as const,
            designName: 'usage/color/background/strong-default',
          },
        },
        neutral: {
          '0': {
            $value: '#FFFFFF',
            $type: 'color' as const,
          },
        },
      },
    },
  };
  const out = figmaAdapter.renderComponent(ButtonIR, tokensWithDesignNames);
  expect(out).toContain('usage/color/background/strong-default');
  expect(out).toContain('color/neutral/0');
});

test('honors registry tokenPathSeparator for refs without designName', () => {
  const out = figmaAdapter.renderComponent(ButtonIR, ButtonTokens, {
    tokenPathSeparator: '-',
  });
  expect(out).toContain('color-brand-500');
  expect(out).toContain('color-neutral-0');
  expect(out).not.toContain('color/brand/500');
});
