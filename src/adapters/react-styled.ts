// adapter that renders a ComponentDefinition into a react component using
// styled-components. variant-driven bindings collapse into ternary chains
// inside a single template literal per styled component

import type { ComponentAdapter } from './types';
import type { ComponentDefinition } from '../core/types';

// adapter for react + styled-components output
export const reactStyledAdapter: ComponentAdapter = {
  target: { framework: 'react', styling: 'styled-components' },

  render(ir, _tokens) {
    const propTypes = Object.entries(ir.variants)
      .map(([k, vs]) => {
        const allBool = vs.every((v) => typeof v === 'boolean');
        if (allBool) return `  ${k}: boolean;`;
        return `  ${k}: ${vs.map((v) => JSON.stringify(v)).join(' | ')};`;
      })
      .join('\n');

    const cssRules = buildCSSRules(ir);

    return [
      `import * as React from "react";`,
      `import styled from "styled-components";`,
      ``,
      `export interface ${ir.name}Props {`,
      propTypes,
      `  children?: React.ReactNode;`,
      `  className?: string;`,
      `}`,
      ``,
      `const Styled${ir.name} = styled.button<${ir.name}Props>\``,
      ...cssRules.map((l) => `  ${l}`),
      `\`;`,
      ``,
      `export function ${ir.name}(props: ${ir.name}Props) {`,
      `  return <Styled${ir.name} {...props}>{props.children}</Styled${ir.name}>;`,
      `}`,
      ``,
    ].join('\n');
  },

  parse(_code) {
    throw new Error(
      'React+styled-components adapter does not support code parsing. Use the .divebar.json sidecar file instead.'
    );
  },
};

// maps ir style props to css property names
const CSS_PROP_MAP: Record<string, string> = {
  background: 'background',
  foreground: 'color',
  borderColor: 'border-color',
  paddingX: 'padding-inline',
  paddingY: 'padding-block',
  gap: 'gap',
  borderRadius: 'border-radius',
  borderWidth: 'border-width',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  lineHeight: 'line-height',
  opacity: 'opacity',
};

// convert ir style rules into styled-components css template literal lines
function buildCSSRules(ir: ComponentDefinition): string[] {
  if (ir.styles.length === 0) return [];

  const lines: string[] = [];
  const propsByCSS = new Map<
    string,
    { variantKey: string; variantVal: string | boolean; ref: string }[]
  >();

  for (const rule of ir.styles) {
    const whenEntries = Object.entries(rule.when);

    for (const [styleProp, tokenRef] of Object.entries(rule.bindings)) {
      const cssProp = CSS_PROP_MAP[styleProp] ?? styleProp;
      if (!propsByCSS.has(cssProp)) propsByCSS.set(cssProp, []);

      if (whenEntries.length === 0) {
        propsByCSS
          .get(cssProp)!
          .push({ variantKey: '', variantVal: '', ref: tokenRef! });
      } else {
        for (const [vk, vv] of whenEntries) {
          propsByCSS
            .get(cssProp)!
            .push({ variantKey: vk, variantVal: vv, ref: tokenRef! });
        }
      }
    }
  }

  for (const [cssProp, entries] of propsByCSS) {
    const unconditional = entries.find((e) => e.variantKey === '');
    const conditional = entries.filter((e) => e.variantKey !== '');

    if (conditional.length === 0 && unconditional) {
      lines.push(`${cssProp}: \${({ theme }) => theme.${unconditional.ref}};`);
    } else if (conditional.length > 0) {
      const destructured = new Set<string>();
      destructured.add('theme');
      for (const c of conditional) destructured.add(c.variantKey);
      const args = Array.from(destructured).join(', ');

      if (conditional.length === 1 && !unconditional) {
        const c = conditional[0]!;
        lines.push(
          `${cssProp}: \${({ ${args} }) => ${renderStyledCond(c)} ? theme.${c.ref} : undefined};`
        );
      } else {
        lines.push(`${cssProp}: \${({ ${args} }) =>`);
        for (const c of conditional) {
          lines.push(`  ${renderStyledCond(c)} ? theme.${c.ref}`);
        }
        if (unconditional) {
          lines.push(`  : theme.${unconditional.ref}};`);
        } else {
          lines.push(`  : undefined};`);
        }
      }
    }
  }

  return lines;
}

// render a single variant condition for a styled-components interpolation
// boolean variants use the prop name (or its negation) directly so theme
// callbacks can destructure the prop without a strict equality check
function renderStyledCond(c: {
  variantKey: string;
  variantVal: string | boolean;
}): string {
  if (typeof c.variantVal === 'boolean') {
    return c.variantVal ? c.variantKey : `!${c.variantKey}`;
  }
  return `${c.variantKey} === ${JSON.stringify(c.variantVal)}`;
}
