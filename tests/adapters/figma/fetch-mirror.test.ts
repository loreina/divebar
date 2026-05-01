import { test, expect, describe } from 'bun:test';
import { figmaToComponent } from '../../../src/adapters/figma/fetch-mirror';
import { ComponentDefinitionSchema } from '../../../src/core/schema';

const FIXTURE_DIR = 'tests/fixtures/figma-mcp';

async function loadFixture(name: string): Promise<unknown> {
  return Bun.file(`${FIXTURE_DIR}/${name}`).json();
}

describe('figmaToComponent', () => {
  test('throws a friendly error on malformed input', () => {
    expect(() =>
      figmaToComponent({}, {}, { codePath: 'src/Bad.tsx' })
    ).toThrow(/Figma MCP response did not match expected shape/);
  });

  test('result round-trips through ComponentDefinitionSchema', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    expect(() => ComponentDefinitionSchema.parse(result)).not.toThrow();
  });

  test('button fixture: variant axes populated from componentProperties', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    expect(result.variants.size).toEqual(['sm', 'lg']);
    expect(result.variants.kind).toEqual(['primary', 'secondary']);
  });

  test('button fixture: variantMappings shape', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    expect(result.variantMappings).toBeDefined();
    expect(result.variantMappings?.size).toEqual({
      designName: 'size',
      values: [
        { code: 'sm', designName: 'Small' },
        { code: 'lg', designName: 'Large' },
      ],
    });
    expect(result.variantMappings?.kind).toEqual({
      designName: 'kind',
      values: [
        { code: 'primary', designName: 'Primary' },
        { code: 'secondary', designName: 'Secondary' },
      ],
    });
  });

  test('button fixture: slots populated from TEXT + INSTANCE_SWAP, code-side names, sorted', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    expect(result.slots).toEqual(['icon', 'label']);
  });

  test('button fixture: per-variant style rule with background binding', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    const rule = result.styles.find(
      (r) =>
        r.when.size === 'sm' &&
        r.when.kind === 'primary' &&
        r.bindings.background !== undefined
    );
    expect(rule).toBeDefined();
    expect(rule?.bindings.background).toBe('colorBrand500');
  });

  test('button fixture: top-level style rule has borderRadius/paddingX/paddingY bindings', async () => {
    const dc = await loadFixture('button-design-context.json');
    const cc = await loadFixture('button-code-connect.json');
    const result = figmaToComponent(dc, cc, {
      codePath: 'src/components/Button.tsx',
    });
    const topLevel = result.styles.find(
      (r) => Object.keys(r.when).length === 0
    );
    expect(topLevel).toBeDefined();
    expect(topLevel?.bindings.borderRadius).toBe('radiusSm');
    expect(topLevel?.bindings.paddingX).toBe('spacingSm');
    expect(topLevel?.bindings.paddingY).toBe('spacingXs');
  });

  test('simple fixture: no variants, single rule with when {}', async () => {
    const dc = await loadFixture('simple-design-context.json');
    // empty object stands in for "no Code Connect data attached in Figma";
    // figmaToComponent should still derive bindings from designContext alone
    const result = figmaToComponent(dc, {}, {
      codePath: 'src/components/Tag.tsx',
    });
    expect(result.variants).toEqual({});
    expect(result.styles).toHaveLength(1);
    expect(result.styles[0]?.when).toEqual({});
    expect(result.styles[0]?.bindings.background).toBe('colorBrand500');
    expect(result.styles[0]?.bindings.borderRadius).toBe('radiusSm');
    expect(result.variantMappings).toBeUndefined();
  });

  test('aria-label fixture: semantics.ariaLabelFromProp is the safe code-side name', async () => {
    const dc = await loadFixture('aria-label-design-context.json');
    const result = figmaToComponent(
      dc,
      {},
      { codePath: 'src/components/IconButton.tsx' }
    );
    expect(result.semantics.ariaLabelFromProp).toBe('ariaLabel');
  });

  test('codePath flows through unchanged from opts.codePath', async () => {
    const dc = await loadFixture('simple-design-context.json');
    const result = figmaToComponent(
      dc,
      {},
      { codePath: 'src/widgets/Custom.tsx' }
    );
    expect(result.codePath).toBe('src/widgets/Custom.tsx');
  });

  test('designSource: prefers designContext.componentKey, falls back to codeConnect.componentKey', () => {
    const dcWithCK = {
      id: '1:10',
      name: 'A',
      type: 'COMPONENT',
      fileKey: 'fk',
      componentKey: 'dc-key',
    };
    const ccWithCK = { componentKey: 'cc-key' };
    const r1 = figmaToComponent(dcWithCK, ccWithCK, {
      codePath: 'src/A.tsx',
    });
    expect(r1.designSource?.tool).toBe('figma');
    expect(r1.designSource?.fileKey).toBe('fk');
    expect(r1.designSource?.nodeId).toBe('1:10');
    expect(r1.designSource?.componentKey).toBe('dc-key');

    const dcNoCK = {
      id: '1:11',
      name: 'A',
      type: 'COMPONENT',
      fileKey: 'fk',
    };
    const r2 = figmaToComponent(dcNoCK, ccWithCK, { codePath: 'src/A.tsx' });
    expect(r2.designSource?.componentKey).toBe('cc-key');
    expect(r2.designSource?.fileKey).toBe('fk');
    expect(r2.designSource?.nodeId).toBe('1:11');
  });

  test('variant value "true" / "false" becomes boolean in variants axis', () => {
    const dc = {
      id: '1:1',
      name: 'Toggle',
      type: 'COMPONENT_SET',
      componentProperties: {
        disabled: { type: 'VARIANT', variantOptions: ['true', 'false'] },
      },
    };
    const result = figmaToComponent(dc, {}, { codePath: 'src/Toggle.tsx' });
    expect(result.variants.disabled).toEqual([true, false]);
  });
});
