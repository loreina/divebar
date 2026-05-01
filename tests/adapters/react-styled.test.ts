import { test, expect } from 'bun:test';
import { reactStyledAdapter } from '../../src/adapters/react-styled';
import { ButtonIR, ButtonTokens } from '../fixtures/button';

test('renders a typed React component using styled-components', () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  expect(code).toContain('export function Button');
  expect(code).toContain(`kind: "primary" | "secondary" | "tertiary"`);
  expect(code).toContain(`size: "sm" | "md" | "lg"`);
  expect(code).toContain(`import styled from "styled-components"`);
  expect(code).toContain('styled.button');
  expect(code).not.toContain('@divebar');
});

test('emits CSS rules from style bindings', () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  expect(code).toContain('color.brand.500');
  expect(code).toContain('color.neutral.0');
  expect(code).toContain('theme');
});

test('parse throws directing to .divebar.json', () => {
  expect(() => reactStyledAdapter.parse('any code')).toThrow('.divebar.json');
});
