import { test, expect } from 'bun:test';
import { runParse } from '../../src/commands/parse';
import { ButtonIR } from '../fixtures/button';

test('validates and re-emits IR JSON', async () => {
  const out = await runParse(JSON.stringify(ButtonIR));
  expect(JSON.parse(out)).toMatchObject({ name: 'Button' });
});

test('rejects invalid IR', async () => {
  await expect(runParse('{"name":"X"}')).rejects.toThrow();
});
