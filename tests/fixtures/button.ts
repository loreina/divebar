import type { ComponentDefinition, TokenSet } from '../../src/core/types';

// note: this fixture exercises the modernized IR + TokenSet shape:
//   - multi-mode color tokens (light/dark) via `$valuesByMode`
//   - tokens carry `designSource` so the figma adapter can rebind to the same Variable
//   - dimension tokens use `designName` to demonstrate the override hook
//   - the IR carries `designSource`, `slots`, and `semantics` so adapters and figma push
//     have everything they need without extra config
//
// kind=tertiary intentionally has no style bindings to keep the "omits variableBindings
// for variants without style rules" figma test meaningful
export const ButtonTokens: TokenSet = {
  modes: [
    { id: 'light', name: 'light', folder: 'light' },
    { id: 'dark', name: 'dark', folder: 'dark' },
  ],
  defaultMode: 'light',
  tokens: {
    color: {
      brand: {
        '500': {
          $valuesByMode: { light: '#5B6CFF', dark: '#7B8CFF' },
          $type: 'color',
          $description: 'primary brand fill',
          designSource: { tool: 'figma', variableId: 'VariableID:1:1' },
        },
      },
      neutral: {
        '0': {
          $valuesByMode: { light: '#FFFFFF', dark: '#0A0A0A' },
          $type: 'color',
          $description: 'surface base',
          designSource: { tool: 'figma', variableId: 'VariableID:1:2' },
        },
      },
    },
    size: {
      sm: {
        $value: '8',
        $type: 'dimension',
        designName: 'spacing/sm',
        designSource: { tool: 'figma', variableId: 'VariableID:2:1' },
      },
      md: {
        $value: '12',
        $type: 'dimension',
        designName: 'spacing/md',
        designSource: { tool: 'figma', variableId: 'VariableID:2:2' },
      },
    },
  },
};

export const ButtonIR: ComponentDefinition = {
  name: 'Button',
  codePath: 'src/Button.tsx',
  designSource: {
    tool: 'figma',
    fileKey: 'fileKey-abc',
    nodeId: '123:456',
    componentKey: 'componentKey-xyz',
  },
  variants: { kind: ['primary', 'secondary', 'tertiary'], size: ['sm', 'md', 'lg'] },
  slots: ['children'],
  styles: [
    {
      when: { kind: 'primary' },
      bindings: { background: 'color.brand.500', foreground: 'color.neutral.0' },
    },
    {
      when: { kind: 'secondary' },
      bindings: { background: 'color.neutral.0', foreground: 'color.brand.500' },
    },
  ],
  semantics: { role: 'button', ariaLabelFromProp: 'aria-label' },
};
