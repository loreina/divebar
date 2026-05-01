import type { ComponentDefinition, TokenSet } from '../../src/core/types';

// fixture that exercises how divebar bridges runtime-driven states (hover,
// pressed, disabled — controlled in code) with design-tool variants (which
// are static rows in a Figma variant table)
//
// the component has two axes:
//   - `kind`  is a real design-time variant ({primary, secondary}) that Figma should know about
//   - `state` is a runtime axis that only exists in code; expanding it into Figma variants
//             would multiply the variant table 4x for no design value
//
// today (with the existing IR shape) the cleanest way to express "Figma should ignore the
// state axis" is to do two things:
//   1. only define a `variantMappings` entry for `kind`, so only `kind` gets a friendly
//      design-tool name; `state` has no mapping, which signals it is a code-side concept
//   2. use `excludeWhen` to filter out every `state` value except the design-time baseline
//      (`default`); the figma adapter then emits a flat 2-variant table (Primary, Secondary)
//      while the codegen adapters still see the full `state` axis and emit ternaries
//
// a cleaner future shape would be a dedicated `runtimeBoundVariants: ['state']` field on
// the IR; that is filed in `.plans/backlog.md` as a deferred enhancement
export const InteractiveTokens: TokenSet = {
  modes: [
    { id: 'light', name: 'light', folder: 'light' },
    { id: 'dark', name: 'dark', folder: 'dark' },
  ],
  defaultMode: 'light',
  tokens: {
    color: {
      brand: {
        default: {
          $valuesByMode: { light: '#5B6CFF', dark: '#7B8CFF' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:10:1' },
        },
        hover: {
          $valuesByMode: { light: '#4A5BF0', dark: '#6A7BF0' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:10:2' },
        },
        pressed: {
          $valuesByMode: { light: '#3A4ACC', dark: '#5A6ACC' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:10:3' },
        },
        disabled: {
          $valuesByMode: { light: '#C5CBFF', dark: '#404873' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:10:4' },
        },
      },
      surface: {
        default: {
          $valuesByMode: { light: '#FFFFFF', dark: '#0A0A0A' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:11:1' },
        },
        hover: {
          $valuesByMode: { light: '#F5F5F5', dark: '#1A1A1A' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:11:2' },
        },
        pressed: {
          $valuesByMode: { light: '#EBEBEB', dark: '#2A2A2A' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:11:3' },
        },
        disabled: {
          $valuesByMode: { light: '#FAFAFA', dark: '#0F0F0F' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:11:4' },
        },
      },
      foreground: {
        onBrand: {
          $valuesByMode: { light: '#FFFFFF', dark: '#0A0A0A' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:12:1' },
        },
        onSurface: {
          $valuesByMode: { light: '#0A0A0A', dark: '#FFFFFF' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:12:2' },
        },
        muted: {
          $valuesByMode: { light: '#9090A0', dark: '#606070' },
          $type: 'color',
          designSource: { tool: 'figma', variableId: 'VariableID:12:3' },
        },
      },
    },
  },
};

export const InteractiveIR: ComponentDefinition = {
  name: 'Interactive',
  codePath: 'src/Interactive.tsx',
  designSource: {
    tool: 'figma',
    fileKey: 'fileKey-interactive',
    nodeId: '789:101',
  },
  variants: {
    kind: ['primary', 'secondary'],
    state: ['default', 'hover', 'disabled', 'pressed'],
  },
  variantMappings: {
    kind: {
      designName: 'Kind',
      values: [
        { code: 'primary', designName: 'Primary' },
        { code: 'secondary', designName: 'Secondary' },
      ],
    },
  },
  excludeWhen: [{ state: ['hover', 'disabled', 'pressed'] }],
  slots: ['children'],
  styles: [
    {
      when: { kind: 'primary' },
      bindings: { background: 'color.brand.default', foreground: 'color.foreground.onBrand' },
    },
    {
      when: { kind: 'primary', state: 'hover' },
      bindings: { background: 'color.brand.hover' },
    },
    {
      when: { kind: 'primary', state: 'pressed' },
      bindings: { background: 'color.brand.pressed' },
    },
    {
      when: { kind: 'primary', state: 'disabled' },
      bindings: {
        background: 'color.brand.disabled',
        foreground: 'color.foreground.muted',
      },
    },
    {
      when: { kind: 'secondary' },
      bindings: {
        background: 'color.surface.default',
        foreground: 'color.foreground.onSurface',
      },
    },
    {
      when: { kind: 'secondary', state: 'hover' },
      bindings: { background: 'color.surface.hover' },
    },
    {
      when: { kind: 'secondary', state: 'pressed' },
      bindings: { background: 'color.surface.pressed' },
    },
    {
      when: { kind: 'secondary', state: 'disabled' },
      bindings: {
        background: 'color.surface.disabled',
        foreground: 'color.foreground.muted',
      },
    },
  ],
  semantics: { role: 'button', ariaLabelFromProp: 'aria-label' },
};
