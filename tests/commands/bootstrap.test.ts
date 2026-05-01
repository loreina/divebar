import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBootstrap } from '../../src/commands/bootstrap';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
});

const RN_BUTTON = `
import React from "react";
import { Pressable, Text } from "react-native";

export interface ButtonProps {
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps) {
  return (
    <Pressable>
      <Text>{props.children}</Text>
    </Pressable>
  );
}
`;

const STYLED_BUTTON = `
import * as React from "react";
import styled from "styled-components";

export interface FancyButtonProps {
  kind?: "primary" | "ghost";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

const Root = styled.button\`\`;

export function FancyButton(props: FancyButtonProps) {
  return <Root>{props.title}{props.children}</Root>;
}
`;

const VIEW_CONTAINER = `
import React from "react";
import { View } from "react-native";

export interface CardProps {
  elevation?: "low" | "medium" | "high";
  children?: React.ReactNode;
}

export function Card(props: CardProps) {
  return <View>{props.children}</View>;
}
`;

test('bootstraps a Pressable-based RN component', async () => {
  const file = `${dir}/Button.tsx`;
  await Bun.write(file, RN_BUTTON);

  const sidecar = await runBootstrap({ codePath: file, designTool: 'figma', designNodeId: '1:2', root: dir });
  expect(sidecar).toContain('Button.divebar.json');

  const ir = JSON.parse(await Bun.file(sidecar).text());
  expect(ir.name).toBe('Button');
  expect(ir.variants.size).toEqual(['sm', 'md', 'lg']);
  expect(ir.variants.variant).toEqual(['primary', 'secondary']);
  expect(ir.variants.disabled).toEqual([false, true]);
  expect(ir.semantics.role).toBe('button');
  expect(ir.designSource).toEqual({ tool: 'figma', nodeId: '1:2' });
  expect(ir.styles).toEqual([{ when: {}, bindings: {} }]);
});

test('bootstraps a styled-components button with text slots', async () => {
  const file = `${dir}/FancyButton.tsx`;
  await Bun.write(file, STYLED_BUTTON);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());
  expect(ir.name).toBe('FancyButton');
  expect(ir.variants.kind).toEqual(['primary', 'ghost']);
  expect(ir.variants.className).toBeUndefined();
  expect(ir.slots).toContain('title');
});

test('bootstraps a View container', async () => {
  const file = `${dir}/Card.tsx`;
  await Bun.write(file, VIEW_CONTAINER);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());
  expect(ir.name).toBe('Card');
  expect(ir.variants.elevation).toEqual(['low', 'medium', 'high']);
  expect(ir.semantics.role).toBe('container');
});

test('refuses to overwrite existing sidecar without --force', async () => {
  const file = `${dir}/Button.tsx`;
  await Bun.write(file, RN_BUTTON);
  await Bun.write(`${dir}/Button.divebar.json`, '{}');

  await expect(runBootstrap({ codePath: file, root: dir })).rejects.toThrow('--force');
});

test('overwrites with --force', async () => {
  const file = `${dir}/Button.tsx`;
  await Bun.write(file, RN_BUTTON);
  await Bun.write(`${dir}/Button.divebar.json`, '{}');

  const sidecar = await runBootstrap({ codePath: file, force: true, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());
  expect(ir.name).toBe('Button');
});

const TYPE_ALIAS_COMPONENT = `
import React from "react";
import { Pressable, View, Text } from "react-native";

type TagSize = "sm" | "md" | "lg";
type TagStyleVariant = "filled" | "outlined" | "ghost";

export interface TagProps {
  size?: TagSize;
  variant?: TagStyleVariant;
  selected?: boolean;
  title?: string;
  LeadIcon?: React.ComponentType<{ size: number }>;
  subtitle?: React.ReactNode;
  accessoryRight?: JSX.Element;
}

export function Tag(props: TagProps) {
  const { LeadIcon } = props;
  return (
    <Pressable>
      {LeadIcon && <LeadIcon size={16} />}
      <Text>{props.title}</Text>
    </Pressable>
  );
}
`;

test('resolves type alias variants and detects slots from props', async () => {
  const file = `${dir}/Tag.tsx`;
  await Bun.write(file, TYPE_ALIAS_COMPONENT);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());

  expect(ir.name).toBe('Tag');
  expect(ir.variants.size).toEqual(['sm', 'md', 'lg']);
  expect(ir.variants.variant).toEqual(['filled', 'outlined', 'ghost']);
  expect(ir.variants.selected).toEqual([false, true]);

  expect(ir.slots).toContain('title');
  expect(ir.slots).toContain('LeadIcon');
  expect(ir.slots).toContain('subtitle');
  expect(ir.slots).toContain('accessoryRight');

  expect(ir.variants.title).toBeUndefined();
  expect(ir.variants.LeadIcon).toBeUndefined();
  expect(ir.variants.subtitle).toBeUndefined();
  expect(ir.variants.accessoryRight).toBeUndefined();

  expect(ir.semantics.role).toBe('button');
});

const STRING_BOOLEAN_UNION = `
import React from "react";
import { View } from "react-native";

export interface ToggleProps {
  active?: "true" | "false";
  visible?: "yes" | "no";
}

export function Toggle(props: ToggleProps) {
  return <View />;
}
`;

test('keeps "true"|"false" string literal unions as strings (not booleans)', async () => {
  const file = `${dir}/Toggle.tsx`;
  await Bun.write(file, STRING_BOOLEAN_UNION);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());

  expect(ir.variants.active).toEqual(['true', 'false']);
  expect(ir.variants.visible).toEqual(['yes', 'no']);
});

const RN_IMAGE_COMPONENT = `
import React from "react";
import { View, ImageSourcePropType } from "react-native";

export interface AvatarProps {
  imageSource?: ImageSourcePropType;
  size?: "sm" | "lg";
}

export function Avatar(props: AvatarProps) {
  return <View />;
}
`;

test('detects ImageSourcePropType as a slot', async () => {
  const file = `${dir}/Avatar.tsx`;
  await Bun.write(file, RN_IMAGE_COMPONENT);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());

  expect(ir.slots).toContain('imageSource');
  expect(ir.variants.imageSource).toBeUndefined();
  expect(ir.variants.size).toEqual(['sm', 'lg']);
});

const STYLE_AS_VARIANT = `
import React from "react";
import { View } from "react-native";

type BadgeStyleVariant = "filled" | "outlined" | "ghost";

export interface BadgeProps {
  style?: BadgeStyleVariant;
  size?: "sm" | "lg";
}

export function Badge(props: BadgeProps) {
  return <View />;
}
`;

test('treats style prop as variant when it has a finite union type', async () => {
  const file = `${dir}/Badge.tsx`;
  await Bun.write(file, STYLE_AS_VARIANT);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());

  expect(ir.variants.style).toEqual(['filled', 'outlined', 'ghost']);
  expect(ir.variants.size).toEqual(['sm', 'lg']);
});

const ARROW_EXPORT_WITH_HELPER = `
import React from "react";
import { Pressable } from "react-native";

function IconView() {
  return null;
}

export interface InfoCardProps {
  variant?: "default" | "emphasis";
}

export const InfoCard = (props: InfoCardProps) => {
  return <Pressable />;
};
`;

test('prefers exported const arrow component over inline uppercase helper', async () => {
  const file = `${dir}/InfoCard.tsx`;
  await Bun.write(file, ARROW_EXPORT_WITH_HELPER);

  const sidecar = await runBootstrap({ codePath: file, root: dir });
  const ir = JSON.parse(await Bun.file(sidecar).text());

  expect(ir.name).toBe('InfoCard');
  expect(ir.variants.variant).toEqual(['default', 'emphasis']);
});
