import { test, expect } from 'bun:test';
import {
  mcpVariableDefsToManifest,
  fetchFigmaVariables,
} from '../../../src/adapters/figma/fetch-tokens';

const fixture = await Bun.file(
  'tests/fixtures/figma-mcp-variable-defs.json'
).json();

test('mcpVariableDefsToManifest produces a manifest in the figma-variables shape', () => {
  const manifest = mcpVariableDefsToManifest(fixture);
  expect(manifest.modes).toEqual({
    '1:0': 'Consumer',
    '1:1': 'Consumer Dark',
  });
  expect(manifest.variables['color/brand/500']).toEqual({
    type: 'COLOR',
    valuesByMode: { '1:0': '#5B6CFF', '1:1': '#3F4FE6' },
  });
  expect(Object.keys(manifest.variables)).toHaveLength(3);
});

test('fetchFigmaVariables returns the cached value when present', async () => {
  let calls = 0;
  const figma = {
    getVariableDefs: async () => {
      calls++;
      return fixture;
    },
  };
  const cached = mcpVariableDefsToManifest(fixture);
  const got = await fetchFigmaVariables({
    fileKey: 'F',
    modes: ['Consumer', 'Consumer Dark'],
    figma,
    cache: {
      read: async () => cached,
      write: async () => {},
    },
  });
  expect(got).toEqual(cached);
  expect(calls).toBe(0);
});

test('fetchFigmaVariables fetches and writes the cache on miss', async () => {
  let written = false;
  const figma = { getVariableDefs: async () => fixture };
  const got = await fetchFigmaVariables({
    fileKey: 'F',
    modes: ['Consumer'],
    figma,
    cache: {
      read: async () => null,
      write: async () => {
        written = true;
      },
    },
  });
  expect(got.modes['1:0']).toBe('Consumer');
  expect(written).toBe(true);
});
