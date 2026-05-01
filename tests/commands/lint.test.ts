import { test, expect } from 'bun:test';
import { lintIR } from '../../src/commands/lint';
import type { ComponentDefinition, TokenSet } from '../../src/core/types';

const tokens: TokenSet = {
  tokens: {
    color: {
      brand: { '500': { $value: '#5B6CFF', $type: 'color' } },
      neutral: { '0': { $value: '#FFF', $type: 'color' } },
    },
  },
};

test('reports grouped missing bindings for uncovered variant combos', () => {
  const ir: ComponentDefinition = {
    name: 'Tag',
    codePath: './Tag.tsx',
    variants: { kind: ['primary', 'secondary'], size: ['sm', 'lg'] },
    slots: [],
    styles: [
      { when: { kind: 'primary' }, bindings: { background: 'color.brand.500' } },
    ],
    semantics: {},
  };
  const report = lintIR(ir, tokens);
  const missingWarnings = report.findings.filter((f) => f.kind === 'missing-binding');
  expect(missingWarnings.length).toBe(1);
  expect(missingWarnings[0]!.message).toContain('of 4 variant combinations missing "background"');
  expect(missingWarnings[0]!.message).toContain('secondary');
});

test('verbose mode reports per-combo missing bindings', () => {
  const ir: ComponentDefinition = {
    name: 'Tag',
    codePath: './Tag.tsx',
    variants: { kind: ['primary', 'secondary'], size: ['sm', 'lg'] },
    slots: [],
    styles: [
      { when: { kind: 'primary' }, bindings: { background: 'color.brand.500' } },
    ],
    semantics: {},
  };
  const report = lintIR(ir, tokens, true);
  const missingWarnings = report.findings.filter((f) => f.kind === 'missing-binding');
  expect(missingWarnings.length).toBe(2);
  expect(missingWarnings.some((f) => f.combo?.kind === 'secondary')).toBe(true);
});

test('reports unknown variant key in when clause', () => {
  const ir: ComponentDefinition = {
    name: 'Test',
    codePath: './Test.tsx',
    variants: { size: ['sm'] },
    slots: [],
    styles: [
      { when: { nonexistent: 'x' }, bindings: { background: 'color.brand.500' } },
    ],
    semantics: {},
  };
  const report = lintIR(ir, tokens);
  expect(report.findings.some((f) => f.kind === 'unknown-variant-key')).toBe(true);
});

test('reports unknown token reference with suggestion', () => {
  const ir: ComponentDefinition = {
    name: 'Test',
    codePath: './Test.tsx',
    variants: { size: ['sm'] },
    slots: [],
    styles: [
      { when: { size: 'sm' }, bindings: { background: 'color.brand.50' } },
    ],
    semantics: {},
  };
  const report = lintIR(ir, tokens);
  const tokenErrors = report.findings.filter((f) => f.kind === 'unknown-token');
  expect(tokenErrors.length).toBe(1);
  expect(tokenErrors[0]!.suggestion).toBe('color.brand.500');
});

test('clean IR produces no findings', () => {
  const ir: ComponentDefinition = {
    name: 'Button',
    codePath: './Button.tsx',
    variants: { kind: ['primary'] },
    slots: [],
    styles: [
      { when: { kind: 'primary' }, bindings: { background: 'color.brand.500' } },
    ],
    semantics: {},
  };
  const report = lintIR(ir, tokens);
  expect(report.findings).toEqual([]);
});

test('warns when an IR has no style bindings (empty bootstrap seed)', () => {
  const ir: ComponentDefinition = {
    name: 'InfoCard',
    codePath: './InfoCard.tsx',
    variants: { variant: ['default', 'emphasis'] },
    slots: [],
    styles: [{ when: {}, bindings: {} }],
    semantics: {},
  };
  const report = lintIR(ir, tokens);
  const empty = report.findings.filter((f) => f.kind === 'empty-bindings');
  expect(empty.length).toBe(1);
  expect(empty[0]!.severity).toBe('warning');
  expect(empty[0]!.message).toContain('no style bindings');
});
