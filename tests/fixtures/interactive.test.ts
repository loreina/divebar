import { test, expect } from 'bun:test';
import { figmaAdapter } from '../../src/adapters/figma';
import { reactNativeStyleSheetAdapter } from '../../src/adapters/react-native-stylesheet';
import { lintIR } from '../../src/commands/lint';
import { ComponentDefinitionSchema } from '../../src/core/schema';
import { InteractiveIR, InteractiveTokens } from './interactive';

test('InteractiveIR validates against the IR schema', () => {
  expect(() => ComponentDefinitionSchema.parse(InteractiveIR)).not.toThrow();
});

test('lint reports zero errors on the InteractiveIR fixture', () => {
  const report = lintIR(InteractiveIR, InteractiveTokens);
  const errors = report.findings.filter((f) => f.severity === 'error');
  expect(errors).toEqual([]);
});

test('codegen emits runtime ternaries for the code-only `state` axis', () => {
  const code = reactNativeStyleSheetAdapter.render(InteractiveIR, InteractiveTokens);

  expect(code).toContain('state?: "default" | "hover" | "disabled" | "pressed"');

  expect(code).toContain('p.state === "hover"');
  expect(code).toContain('p.state === "pressed"');
  expect(code).toContain('p.state === "disabled"');

  expect(code).toContain('t.color.brand.hover');
  expect(code).toContain('t.color.brand.pressed');
  expect(code).toContain('t.color.brand.disabled');
});

test('figma push omits runtime-only state values from the variant table', () => {
  const script = figmaAdapter.renderComponent(InteractiveIR, InteractiveTokens);

  expect(script).toContain('Kind=Primary');
  expect(script).toContain('Kind=Secondary');

  expect(script).not.toContain('state=hover');
  expect(script).not.toContain('state=pressed');
  expect(script).not.toContain('state=disabled');

  const matches = script.match(/"name":/g);
  expect(matches?.length).toBe(2);
});

test('figma variableBindings only reference design-time tokens, never runtime-only ones', () => {
  const script = figmaAdapter.renderComponent(InteractiveIR, InteractiveTokens);
  const bindingsMatch = script.match(/const variableBindings = (\{[\s\S]*?\});/);
  expect(bindingsMatch).not.toBeNull();
  const bindings = JSON.parse(bindingsMatch![1]!);

  const refs = Object.values(bindings).flatMap((v) =>
    Object.values(v as Record<string, string>)
  );

  expect(refs.some((r) => r.includes('hover'))).toBe(false);
  expect(refs.some((r) => r.includes('pressed'))).toBe(false);
  expect(refs.some((r) => r.includes('disabled'))).toBe(false);
});
