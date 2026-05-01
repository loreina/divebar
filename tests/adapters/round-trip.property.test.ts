import { test, expect } from 'bun:test';
import { ComponentDefinitionSchema } from '../../src/core/schema';
import type { ComponentDefinition } from '../../src/core/types';

test('IR round-trips through JSON serialization and schema parsing', () => {
  const ir: ComponentDefinition = {
    name: 'Widget',
    codePath: 'src/Widget.tsx',
    designSource: { tool: 'figma', nodeId: '1:2' },
    variants: { size: ['sm', 'lg'], kind: ['a', 'b'] },
    slots: ['children'],
    styles: [{ when: { size: 'sm' }, bindings: { paddingX: 'space.sm' } }],
    semantics: { role: 'button' },
  };

  const json = JSON.stringify(ir);
  const parsed = ComponentDefinitionSchema.parse(JSON.parse(json));
  expect(parsed.name).toBe(ir.name);
  expect(parsed.variants).toEqual(ir.variants);
  expect(parsed.slots).toEqual(ir.slots);
  expect(parsed.designSource).toEqual(ir.designSource);
});
