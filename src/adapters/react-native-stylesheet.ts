// adapter that renders a ComponentDefinition into a react-native component
// using StyleSheet.create plus a theme hook for token lookup. variant-driven
// styles are encoded as ternary chains over props inside makeStyles

import type { ComponentAdapter, ThemeConfig } from './types';
import type { ComponentDefinition } from '../core/types';
import { collectBindingsByProp } from '../core/variants';

// fallback theme config when none is provided
const DEFAULT_THEME: ThemeConfig = { hook: 'useTheme', import: '@app/tokens' };

// adapter for react native + stylesheet output
export const reactNativeStyleSheetAdapter: ComponentAdapter = {
  target: { framework: 'react-native', styling: 'stylesheet' },

  render(ir, _tokens, themeConfig) {
    const theme = themeConfig ?? DEFAULT_THEME;
    const propLines = buildPropTypes(ir);
    const rnImports = inferRNImports(ir);
    const styleLines = buildStyleBlock(ir);
    const rootTag = ir.semantics.role === 'button' ? 'Pressable' : 'View';
    const hasChildren =
      ir.slots.includes('children') || ir.slots.some(isTextSlot);

    const body = hasChildren
      ? `    <${rootTag} style={styles.root}>\n      {props.children}\n    </${rootTag}>`
      : `    <${rootTag} style={styles.root} />`;

    return [
      `import React from "react";`,
      `import { ${rnImports.join(', ')} } from "react-native";`,
      `import { ${theme.hook} } from "${theme.import}";`,
      ``,
      `export interface ${ir.name}Props {`,
      ...propLines.map((l) => `  ${l}`),
      `  children?: React.ReactNode;`,
      `}`,
      ``,
      `export function ${ir.name}(props: ${ir.name}Props) {`,
      `  const t = ${theme.hook}();`,
      `  const styles = makeStyles(t, props);`,
      `  return (`,
      body,
      `  );`,
      `}`,
      ``,
      `function makeStyles(t: any, p: ${ir.name}Props) {`,
      `  return StyleSheet.create({`,
      ...styleLines.map((l) => `    ${l}`),
      `  });`,
      `}`,
      ``,
    ].join('\n');
  },

  parse(_code) {
    throw new Error(
      'RN+StyleSheet adapter does not support code parsing. Use the .divebar.json sidecar file instead.'
    );
  },
};

// emit typescript prop type lines from variant definitions
function buildPropTypes(ir: ComponentDefinition): string[] {
  return Object.entries(ir.variants).map(([key, values]) => {
    const allBool = values.every((v) => typeof v === 'boolean');
    if (allBool) return `${key}?: boolean;`;
    const union = values.map((v) => JSON.stringify(v)).join(' | ');
    return `${key}?: ${union};`;
  });
}

// determine which react-native imports the component needs
function inferRNImports(ir: ComponentDefinition): string[] {
  const imports = new Set(['StyleSheet', 'View']);
  if (ir.semantics.role === 'button') imports.add('Pressable');
  if (ir.slots.some(isTextSlot)) imports.add('Text');
  return Array.from(imports).sort();
}

// true for slot names that represent text content
function isTextSlot(s: string): boolean {
  const lower = s.toLowerCase();
  return lower === 'title' || lower === 'label' || lower.includes('text');
}

// maps ir style props to react native style property names
const RN_PROP_MAP: Record<string, string> = {
  background: 'backgroundColor',
  foreground: 'color',
  paddingX: 'paddingHorizontal',
  paddingY: 'paddingVertical',
};

// build the stylesheet.create block with ternary chains for conditional styles
function buildStyleBlock(ir: ComponentDefinition): string[] {
  const byProp = collectBindingsByProp(ir.styles);
  if (byProp.size === 0) return [`root: {},`];

  const lines: string[] = [`root: {`];

  for (const [prop, rules] of byProp) {
    const rnProp = RN_PROP_MAP[prop] ?? prop;
    lines.push(`  ${rnProp}: ${renderConditional(rules)},`);
  }

  lines.push(`},`);
  return lines;
}

// emit a ternary chain for conditional style rules, with a base fallback
function renderConditional(
  rules: { when: Record<string, string | boolean>; ref: string }[]
): string {
  const conditional = rules.filter((r) => Object.keys(r.when).length > 0);
  const base = rules.find((r) => Object.keys(r.when).length === 0);

  if (conditional.length === 0 && base) {
    return `t.${base.ref}`;
  }

  const parts: string[] = [];

  for (const r of conditional) {
    parts.push(`${renderWhen(r.when)} ? t.${r.ref}`);
  }

  if (base) {
    parts.push(`t.${base.ref}`);
  } else {
    parts.push(`undefined`);
  }

  if (parts.length === 2) {
    return `${parts[0]} : ${parts[1]}`;
  }

  return parts.slice(0, -1).join(' : ') + ' : ' + parts[parts.length - 1];
}

// render a condition expression like `p.size === "lg"` or `p.selected`
function renderWhen(when: Record<string, string | boolean>): string {
  const conds = Object.entries(when).map(([k, v]) => {
    if (typeof v === 'boolean') return v ? `p.${k}` : `!p.${k}`;
    return `p.${k} === ${JSON.stringify(v)}`;
  });

  return conds.length === 1 ? conds[0]! : `(${conds.join(' && ')})`;
}
