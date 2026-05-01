import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guessFramework } from '../../src/core/framework-detect';

let tmpRoots: string[];

beforeEach(() => {
  tmpRoots = [];
});

afterEach(async () => {
  await Promise.all(
    tmpRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function makeProject(opts: {
  pkg?: Record<string, unknown> | string;
  hasSrc?: boolean;
  hasSrcComponents?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-fwd-'));
  tmpRoots.push(root);
  if (opts.pkg !== undefined) {
    const body =
      typeof opts.pkg === 'string' ? opts.pkg : JSON.stringify(opts.pkg);
    await writeFile(join(root, 'package.json'), body, 'utf8');
  }
  if (opts.hasSrc || opts.hasSrcComponents) {
    await mkdir(join(root, 'src'), { recursive: true });
  }
  if (opts.hasSrcComponents) {
    await mkdir(join(root, 'src', 'components'), { recursive: true });
  }
  return root;
}

test('react-native in dependencies → react-native + stylesheet', async () => {
  const root = await makeProject({
    pkg: { dependencies: { 'react-native': '0.74.0' } },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react-native');
  expect(result.styling).toBe('stylesheet');
});

test('react-native in devDependencies → react-native + stylesheet', async () => {
  const root = await makeProject({
    pkg: { devDependencies: { 'react-native': '0.74.0' } },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react-native');
  expect(result.styling).toBe('stylesheet');
});

test('tailwindcss in deps, no react-native → react + tailwind', async () => {
  const root = await makeProject({
    pkg: { dependencies: { tailwindcss: '^3.4.0' } },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react');
  expect(result.styling).toBe('tailwind');
});

test('styled-components in deps, no tailwind, no RN → react + styled-components', async () => {
  const root = await makeProject({
    pkg: { dependencies: { 'styled-components': '^6.1.0' } },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react');
  expect(result.styling).toBe('styled-components');
});

test('empty deps → react + styled-components defaults', async () => {
  const root = await makeProject({
    pkg: { dependencies: {}, devDependencies: {} },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react');
  expect(result.styling).toBe('styled-components');
});

test('missing package.json → react + styled-components defaults', async () => {
  const root = await makeProject({});
  const result = await guessFramework(root);
  expect(result.framework).toBe('react');
  expect(result.styling).toBe('styled-components');
});

test('malformed package.json → defaults, does not throw', async () => {
  const root = await makeProject({ pkg: 'not json' });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react');
  expect(result.styling).toBe('styled-components');
});

test('react-native + tailwind both in deps → react-native wins', async () => {
  const root = await makeProject({
    pkg: {
      dependencies: { 'react-native': '0.74.0', tailwindcss: '^3.4.0' },
    },
  });
  const result = await guessFramework(root);
  expect(result.framework).toBe('react-native');
  expect(result.styling).toBe('stylesheet');
});

test('src/components/ exists → outputDir is src/components', async () => {
  const root = await makeProject({ hasSrcComponents: true });
  const result = await guessFramework(root);
  expect(result.outputDir).toBe('src/components');
});

test('src/ exists but no src/components/ → outputDir components, tokensPath src/tokens.ts', async () => {
  const root = await makeProject({ hasSrc: true });
  const result = await guessFramework(root);
  expect(result.outputDir).toBe('components');
  expect(result.tokensPath).toBe('src/tokens.ts');
});

test('no src/ at all → outputDir components, tokensPath tokens.ts', async () => {
  const root = await makeProject({});
  const result = await guessFramework(root);
  expect(result.outputDir).toBe('components');
  expect(result.tokensPath).toBe('tokens.ts');
});

test('src/components/ + src/ → outputDir src/components and tokensPath src/tokens.ts', async () => {
  const root = await makeProject({ hasSrc: true, hasSrcComponents: true });
  const result = await guessFramework(root);
  expect(result.outputDir).toBe('src/components');
  expect(result.tokensPath).toBe('src/tokens.ts');
});
