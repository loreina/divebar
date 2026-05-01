import { test, expect } from 'bun:test';
import { walkFigma } from '../../../src/adapters/figma/walk';

const fixture = await Bun.file(
  'tests/fixtures/figma-frame-with-issues.json'
).json();

function fakeFigma() {
  return {
    getMetadata: async ({ nodeId }: { fileKey: string; nodeId?: string }) => {
      if (!nodeId || nodeId === '1:1') return [fixture];
      return [];
    },
  };
}

test('walkFigma yields the root and every child once', async () => {
  const ids: string[] = [];
  for await (const node of walkFigma({
    fileKey: 'F',
    rootNodeId: '1:1',
    figma: fakeFigma(),
  })) {
    ids.push(node.id);
  }
  expect(ids).toEqual(['1:1', '2:1', '2:2', '2:3', '2:4', '2:5', '2:6', '2:7']);
});

test('walkFigma sets parentId on children', async () => {
  for await (const node of walkFigma({
    fileKey: 'F',
    rootNodeId: '1:1',
    figma: fakeFigma(),
  })) {
    if (node.id === '2:3') {
      expect(node.parentId).toBe('1:1');
    }
  }
});
