import { test, expect } from 'bun:test';
import { ComponentDefinitionSchema, TokenSetSchema } from '../../src/core/schema';

test('rejects component with unknown style prop', () => {
  const bad = {
    name: 'X',
    codePath: 'X.tsx',
    variants: {},
    slots: [],
    styles: [{ when: {}, bindings: { neon: 'color.x' } }],
    semantics: {},
  };
  expect(() => ComponentDefinitionSchema.parse(bad)).toThrow();
});

test('accepts a minimal valid component', () => {
  const good = {
    name: 'Button',
    codePath: 'src/Button.tsx',
    designSource: { tool: 'figma', nodeId: '1:2' },
    variants: { kind: ['primary'] },
    slots: ['children'],
    styles: [{ when: { kind: 'primary' }, bindings: { background: 'color.brand.500' } }],
    semantics: { role: 'button' },
  };
  expect(ComponentDefinitionSchema.parse(good)).toMatchObject({ name: 'Button' });
});

test('accepts a token set with nested groups', () => {
  const ts = { tokens: { color: { brand: { '500': { $value: '#5B6CFF', $type: 'color' } } } } };
  expect(TokenSetSchema.parse(ts)).toMatchObject({ tokens: {} });
});

test('accepts component with variantMappings and excludeWhen', () => {
  const ir = {
    name: 'Tag',
    codePath: './Tag.tsx',
    designSource: { tool: 'figma', nodeId: '39:211' },
    variants: { size: ['small', 'large'] },
    variantMappings: {
      size: { designName: 'Size', values: [{ code: 'small', designName: 'Small' }, { code: 'large', designName: 'Large' }] },
    },
    excludeWhen: [{ size: 'small' }],
    slots: [],
    styles: [],
    semantics: {},
  };
  expect(ComponentDefinitionSchema.parse(ir)).toMatchObject({ name: 'Tag' });
});

test('accepts multi-mode tokens with designSource (legacy string[] modes coerce to ModeInfo[])', () => {
  const ts = {
    modes: ['light', 'dark'],
    defaultMode: 'light',
    tokens: {
      bg: {
        $type: 'color',
        $valuesByMode: { light: '#FFF', dark: '#000' },
        designSource: { tool: 'figma', variableId: 'VariableID:1:2' },
        designName: 'usage/color/bg',
      },
    },
  };
  expect(TokenSetSchema.parse(ts)).toMatchObject({
    modes: [
      { id: 'light', name: 'light', folder: 'light' },
      { id: 'dark', name: 'dark', folder: 'dark' },
    ],
  });
});

test('accepts token with $alias', () => {
  const ts = {
    tokens: {
      base: { $type: 'color', $value: '#FFF' },
      alias: { $type: 'color', $value: { $alias: 'base' } },
    },
  };
  expect(TokenSetSchema.parse(ts)).toMatchObject({});
});

test('accepts slash/dash token refs in bindings', () => {
  const ir = {
    name: 'X',
    codePath: 'X.tsx',
    variants: { v: ['a'] },
    slots: [],
    styles: [{ when: { v: 'a' }, bindings: { background: 'usage/color/bg-default' } }],
    semantics: {},
  };
  expect(ComponentDefinitionSchema.parse(ir)).toMatchObject({ name: 'X' });
});
