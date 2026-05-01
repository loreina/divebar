import { test, expect } from 'bun:test';
import { MirrorSchema, MirrorEntrySchema } from '../../src/core/mirror-schema';

test('MirrorEntrySchema accepts a fully-populated component', () => {
  const c = {
    name: 'Tag',
    nodeId: '31854:163353',
    componentKey: 'abc123',
    variantProperties: { Size: ['Small', 'Large'] },
    children: [{ name: 'Size=Small', nodeId: '31854:163354' }],
  };
  expect(MirrorEntrySchema.parse(c)).toEqual(c);
});

test('MirrorEntrySchema allows null componentKey', () => {
  const c = {
    name: 'Tag',
    nodeId: '31854:163353',
    componentKey: null,
    variantProperties: {},
    children: [],
  };
  expect(MirrorEntrySchema.parse(c).componentKey).toBeNull();
});

test('MirrorSchema parses an array of components', () => {
  const m = [
    {
      name: 'Tag',
      nodeId: '1:1',
      componentKey: null,
      variantProperties: {},
      children: [],
    },
  ];
  expect(MirrorSchema.parse(m)).toEqual(m);
});

test('MirrorEntrySchema rejects missing required fields', () => {
  expect(() => MirrorEntrySchema.parse({ name: 'Tag' })).toThrow();
});
