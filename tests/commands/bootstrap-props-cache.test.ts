// covers the props-cache bootstrap mode: extracting <Name>Props metadata
// (type, required, jsdoc, destructuring defaults) into a single json file
// for downstream consumers, plus the directory-walk include/exclude rules

import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBootstrap } from '../../src/commands/bootstrap';

const componentSrc = `
import * as React from 'react';

export interface ButtonProps {
  /** The button label rendered inside */
  label: string;
  /** Visual variant */
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  onPress?: () => void;
}

export const Button = (props: ButtonProps) => <button>{props.label}</button>;
`;

test('--emit props-cache extracts name/type/required/description for every prop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-pc-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'Button.tsx'), componentSrc);

  await runBootstrap({
    codePath: join(dir, 'src'),
    emit: 'props-cache',
    outputPath: join(dir, 'props.json'),
  });

  const cache = JSON.parse(await readFile(join(dir, 'props.json'), 'utf8'));
  expect(cache).toHaveProperty('Button');
  const buttonProps = cache.Button.props;

  const label = buttonProps.find((p: any) => p.name === 'label');
  expect(label).toEqual({
    name: 'label',
    type: 'string',
    required: true,
    description: 'The button label rendered inside',
  });

  const variant = buttonProps.find((p: any) => p.name === 'variant');
  expect(variant).toMatchObject({
    name: 'variant',
    type: "'primary' | 'secondary'",
    required: false,
    description: 'Visual variant',
  });

  const disabled = buttonProps.find((p: any) => p.name === 'disabled');
  expect(disabled.required).toBe(false);
});

test('default --emit mode is spec-sidecar (back-compat)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-pc-default-'));
  const file = join(dir, 'Button.tsx');
  await writeFile(file, componentSrc);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  expect(sidecar).toContain('Button.divebar.json');

  const ir = JSON.parse(await readFile(sidecar, 'utf8'));
  expect(ir.name).toBe('Button');
});

test('directory walk descends into nested folders, skipping node_modules and dist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-pc-walk-'));
  await mkdir(join(dir, 'src', 'nested'), { recursive: true });
  await mkdir(join(dir, 'src', 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(dir, 'src', 'dist'), { recursive: true });

  const buttonSrc = `
import * as React from 'react';
export interface ButtonProps { label: string; }
export const Button = (props: ButtonProps) => <button>{props.label}</button>;
`;
  const nestedSrc = `
import * as React from 'react';
export interface CardProps { title: string; }
export const Card = (props: CardProps) => <div>{props.title}</div>;
`;
  const ignoredSrc = `
import * as React from 'react';
export interface IgnoredProps { ignore: string; }
export const Ignored = (props: IgnoredProps) => <div>{props.ignore}</div>;
`;

  await writeFile(join(dir, 'src', 'Button.tsx'), buttonSrc);
  await writeFile(join(dir, 'src', 'nested', 'Card.tsx'), nestedSrc);
  await writeFile(
    join(dir, 'src', 'node_modules', 'pkg', 'Ignored.tsx'),
    ignoredSrc
  );
  await writeFile(join(dir, 'src', 'dist', 'Ignored.tsx'), ignoredSrc);

  await runBootstrap({
    codePath: join(dir, 'src'),
    emit: 'props-cache',
    outputPath: join(dir, 'props.json'),
  });

  const cache = JSON.parse(await readFile(join(dir, 'props.json'), 'utf8'));
  expect(cache).toHaveProperty('Button');
  expect(cache).toHaveProperty('Card');
  expect(cache).not.toHaveProperty('Ignored');
});

test('components without a <Name>Props interface are silently skipped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-pc-skip-'));
  await mkdir(join(dir, 'src'), { recursive: true });

  const noProps = `
import * as React from 'react';
export const NoPropsComponent = () => <div />;
`;
  const withProps = `
import * as React from 'react';
export interface ButtonProps { label: string; }
export const Button = (props: ButtonProps) => <button>{props.label}</button>;
`;

  await writeFile(join(dir, 'src', 'NoPropsComponent.tsx'), noProps);
  await writeFile(join(dir, 'src', 'Button.tsx'), withProps);

  await runBootstrap({
    codePath: join(dir, 'src'),
    emit: 'props-cache',
    outputPath: join(dir, 'props.json'),
  });

  const cache = JSON.parse(await readFile(join(dir, 'props.json'), 'utf8'));
  expect(cache).toHaveProperty('Button');
  expect(cache).not.toHaveProperty('NoPropsComponent');
});

test('default values via destructuring appear as default field on the entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spec-pc-defaults-'));
  await mkdir(join(dir, 'src'), { recursive: true });

  const componentWithDefaults = `
import * as React from 'react';

export interface ButtonProps {
  label: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export const Button = ({ label, disabled = false, variant = 'primary' }: ButtonProps) => (
  <button disabled={disabled}>{label}</button>
);
`;

  await writeFile(join(dir, 'src', 'Button.tsx'), componentWithDefaults);

  await runBootstrap({
    codePath: join(dir, 'src'),
    emit: 'props-cache',
    outputPath: join(dir, 'props.json'),
  });

  const cache = JSON.parse(await readFile(join(dir, 'props.json'), 'utf8'));
  const buttonProps = cache.Button.props;

  const disabled = buttonProps.find((p: any) => p.name === 'disabled');
  expect(disabled.default).toBe(false);

  const variant = buttonProps.find((p: any) => p.name === 'variant');
  expect(variant.default).toBe('primary');
});
