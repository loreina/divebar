import { test, expect } from 'bun:test';
import { reactNativeStyleSheetAdapter } from '../../src/adapters/react-native-stylesheet';
import type { ComponentDefinition } from '../../src/core/types';
import { ButtonIR, ButtonTokens } from '../fixtures/button';

test('renders an RN component with StyleSheet', () => {
  const code = reactNativeStyleSheetAdapter.render(ButtonIR, ButtonTokens, {
    hook: 'useTheme',
    import: '@acme/tokens',
  });
  expect(code).toContain('import React from "react"');
  expect(code).toContain('from "react-native"');
  expect(code).toContain('useTheme');
  expect(code).toContain('@acme/tokens');
  expect(code).toContain('StyleSheet.create');
  expect(code).toContain('export function Button');
  expect(code).toContain('Pressable');
});

test('uses default theme config when none provided', () => {
  const code = reactNativeStyleSheetAdapter.render(ButtonIR, ButtonTokens);
  expect(code).toContain('useTheme');
  expect(code).toContain('@app/tokens');
});

test('emits conditional ternaries for all style rules', () => {
  const tagIR: ComponentDefinition = {
    name: 'Tag',
    codePath: './Tag.tsx',
    variants: {
      variant: ['default', 'inverse'],
      selected: ['false', 'true'],
      size: ['small', 'medium', 'large'],
    },
    slots: ['title'],
    styles: [
      { when: { variant: 'default', selected: 'false' }, bindings: { background: 'bgDefault' } },
      { when: { variant: 'default', selected: 'true' }, bindings: { background: 'bgSelected' } },
      { when: { variant: 'inverse' }, bindings: { background: 'bgInverse' } },
      { when: { size: 'small' }, bindings: { paddingY: 'spaceXxSmall' } },
      { when: { size: 'medium' }, bindings: { paddingY: 'spaceXSmall' } },
      { when: { size: 'large' }, bindings: { paddingY: 'spaceSmall' } },
    ],
    semantics: { role: 'button' },
  };
  const code = reactNativeStyleSheetAdapter.render(tagIR, { tokens: {} });
  expect(code).toContain('p.selected === "true"');
  expect(code).toContain('t.bgSelected');
  expect(code).toContain('p.variant === "inverse"');
  expect(code).toContain('t.bgInverse');
  expect(code).toContain('t.bgDefault');
  expect(code).toContain('p.size === "small"');
  expect(code).toContain('t.spaceXxSmall');
  expect(code).toContain('p.size === "medium"');
  expect(code).toContain('t.spaceXSmall');
  expect(code).toContain('p.size === "large"');
  expect(code).toContain('t.spaceSmall');
});

test('every binding in IR appears in generated code', () => {
  const code = reactNativeStyleSheetAdapter.render(ButtonIR, ButtonTokens);
  for (const rule of ButtonIR.styles) {
    for (const ref of Object.values(rule.bindings)) {
      expect(code).toContain(`t.${ref}`);
    }
  }
});

test('parse throws directing to .divebar.json', () => {
  expect(() => reactNativeStyleSheetAdapter.parse('any code')).toThrow('.divebar.json');
});
