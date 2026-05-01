import { test, expect } from 'bun:test';
import { defineEmitter } from '../../src/emit/define-emitter';
import type { EmitContext } from '../../src/emit/define-emitter';
import type { TokenSet } from '../../src/core/types';

test('defineEmitter returns the object as-is and types the emit function', async () => {
  const calls: EmitContext[] = [];
  const emitter = defineEmitter({
    name: 'test',
    emit: async (ctx) => {
      calls.push(ctx);
      return [{ path: 'out.ts', contents: 'x' }];
    },
  });
  const files = await emitter.emit({
    tokens: { tokens: {} } as TokenSet,
    modes: [],
    outDir: '/tmp',
  });
  expect(files[0]?.path).toBe('out.ts');
  expect(calls).toHaveLength(1);
});
