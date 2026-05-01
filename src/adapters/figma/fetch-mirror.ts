// translates figma mcp get_design_context + get_context_for_code_connect
// responses into a ComponentDefinition. schemas use .passthrough() so
// unknown fields don't break parsing while the real shape is captured

import { z } from 'zod';
import { ComponentDefinitionSchema } from '../../core/schema';
import type {
  ComponentDefinition,
  DesignSource,
  Semantics,
  StyleProp,
  StyleRule,
  VariantAxes,
  VariantMapping,
  VariantSelector,
  VariantValue,
  VariantValueMapping,
} from '../../core/types';
import {
  normalizePropName,
  normalizeTokenRef,
  safePropName,
} from '../../utils/normalize';

// ----- mcp response schemas -----

// figma variable alias: id is required; name is optional and used as a
// human-readable token ref when present (see variableToTokenRef)
const FigmaVariableRefSchema = z
  .object({
    type: z.literal('VARIABLE_ALIAS'),
    id: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

// a single fill paint with optional variable bindings
const FigmaPaintSchema = z
  .object({
    type: z.string(),
    visible: z.boolean().optional(),
    boundVariables: z.record(z.string(), FigmaVariableRefSchema).optional(),
  })
  .passthrough();

// a single effect (shadow, blur) with optional variable bindings
const FigmaEffectSchema = z
  .object({
    type: z.string(),
    visible: z.boolean().optional(),
    boundVariables: z.record(z.string(), FigmaVariableRefSchema).optional(),
  })
  .passthrough();

// the style payload attached to a node (paint, layout, and bound variables)
const FigmaStyleSchema = z
  .object({
    fills: z.array(FigmaPaintSchema).optional(),
    strokes: z.array(FigmaPaintSchema).optional(),
    effects: z.array(FigmaEffectSchema).optional(),
    boundVariables: z.record(z.string(), FigmaVariableRefSchema).optional(),
    cornerRadius: z.number().optional(),
    strokeWeight: z.number().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    itemSpacing: z.number().optional(),
  })
  .passthrough();

// declared component property (variant axis, boolean toggle, slot, text)
const FigmaComponentPropertySchema = z
  .object({
    type: z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT']),
    defaultValue: z.unknown().optional(),
    variantOptions: z.array(z.string()).optional(),
  })
  .passthrough();

// a single variant inside a component set
const FigmaVariantSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.string()).optional(),
    style: FigmaStyleSchema.optional(),
  })
  .passthrough();

// top-level shape returned by get_design_context for a component or set
const FigmaDesignContextSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z
      .enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'FRAME'])
      .or(z.string()),
    fileKey: z.string().optional(),
    componentKey: z.string().optional(),
    variants: z.array(FigmaVariantSchema).optional(),
    componentProperties: z
      .record(z.string(), FigmaComponentPropertySchema)
      .optional(),
    style: FigmaStyleSchema.optional(),
  })
  .passthrough();

// shape returned by get_context_for_code_connect: variant + prop name mappings
const FigmaCodeConnectSchema = z
  .object({
    componentKey: z.string().optional(),
    variantMappings: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional(),
    propBindings: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

type FigmaDesignContext = z.infer<typeof FigmaDesignContextSchema>;
type FigmaCodeConnect = z.infer<typeof FigmaCodeConnectSchema>;
type FigmaStyle = z.infer<typeof FigmaStyleSchema>;
type FigmaVariant = z.infer<typeof FigmaVariantSchema>;
type FigmaVariableRef = z.infer<typeof FigmaVariableRefSchema>;

// ----- parsers -----

// flatten zod issues into a single user-facing string for error messages
function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.join('.') || '<root>';
      return `${path}: ${i.message}`;
    })
    .join('; ');
}

// parse a get_design_context response, throwing with a readable summary on miss
function parseDesignContext(input: unknown): FigmaDesignContext {
  const result = FigmaDesignContextSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Figma MCP response did not match expected shape: ${summarizeIssues(result.error)}`
    );
  }
  return result.data;
}

// parse a get_context_for_code_connect response with the same error shape
function parseCodeConnect(input: unknown): FigmaCodeConnect {
  const result = FigmaCodeConnectSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Figma MCP response did not match expected shape: ${summarizeIssues(result.error)}`
    );
  }
  return result.data;
}

// ----- variants -----

// promote stringy "true"/"false" to real booleans so figma toggles round-trip
function coerceVariantValue(s: string): VariantValue {
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// fall back path: parse a variant name like "Kind=Primary, Size=Large" when
// the variant has no structured properties map
function parseVariantName(name: string): VariantSelector {
  const selector: VariantSelector = {};
  for (const part of name.split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const rawKey = trimmed.slice(0, eq).trim();
    const rawVal = trimmed.slice(eq + 1).trim();
    if (!rawKey) continue;
    const key = safePropName(normalizePropName(rawKey));
    const val = normalizePropName(rawVal);
    selector[key] = coerceVariantValue(val);
  }
  return selector;
}

// prefer the structured properties map; fall back to parsing the variant name
function variantSelectorFor(v: FigmaVariant): VariantSelector {
  if (v.properties && Object.keys(v.properties).length > 0) {
    const selector: VariantSelector = {};
    for (const [k, val] of Object.entries(v.properties)) {
      const key = safePropName(normalizePropName(k));
      const normalized = normalizePropName(val);
      selector[key] = coerceVariantValue(normalized);
    }
    return selector;
  }
  return parseVariantName(v.name);
}

// dedupe and normalize a variant axis's options, preserving declaration order
function variantOptionsToValues(opts: string[]): VariantValue[] {
  const out: VariantValue[] = [];
  const seen = new Set<string>();
  for (const opt of opts) {
    const normalized = normalizePropName(opt);
    const value = coerceVariantValue(normalized);
    const fingerprint =
      typeof value === 'boolean' ? `b:${value}` : `s:${value}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(value);
  }
  return out;
}

// derive variant axes from the design context
// priority: declared componentProperties of type VARIANT win when present;
// otherwise fall back to inspecting the variants array. axes whose value
// list ends up empty are skipped so the ir doesn't carry dead keys
function computeVariantAxes(dc: FigmaDesignContext): VariantAxes {
  const axes: VariantAxes = {};
  const props = dc.componentProperties;

  if (props) {
    let foundVariantProp = false;
    for (const [name, prop] of Object.entries(props)) {
      if (prop.type !== 'VARIANT') continue;
      foundVariantProp = true;
      const key = safePropName(normalizePropName(name));
      const values = variantOptionsToValues(prop.variantOptions ?? []);
      if (values.length === 0) continue;
      axes[key] = values;
    }
    if (foundVariantProp) return axes;
  }

  if (dc.variants && dc.variants.length > 0) {
    const collected: Record<
      string,
      { order: VariantValue[]; seen: Set<string> }
    > = {};
    for (const v of dc.variants) {
      const sel = variantSelectorFor(v);
      for (const [k, val] of Object.entries(sel)) {
        const bucket = collected[k] ?? { order: [], seen: new Set<string>() };
        const fp = typeof val === 'boolean' ? `b:${val}` : `s:${val}`;
        if (!bucket.seen.has(fp)) {
          bucket.seen.add(fp);
          bucket.order.push(val);
        }
        collected[k] = bucket;
      }
    }
    for (const [k, bucket] of Object.entries(collected)) {
      if (bucket.order.length === 0) continue;
      axes[k] = bucket.order;
    }
  }

  return axes;
}

// translate code connect's variantMappings table into our VariantMapping shape
function computeVariantMappings(
  cc: FigmaCodeConnect
): Record<string, VariantMapping> | undefined {
  const vm = cc.variantMappings;
  if (!vm || Object.keys(vm).length === 0) return undefined;
  const out: Record<string, VariantMapping> = {};
  for (const [key, mapping] of Object.entries(vm)) {
    const values: VariantValueMapping[] = [];
    for (const [codeValue, designValue] of Object.entries(mapping)) {
      values.push({ code: codeValue, designName: designValue });
    }
    out[key] = { designName: key, values };
  }
  return out;
}

// ----- slots, styles, semantics -----

// derive slot names from componentProperties of type INSTANCE_SWAP or TEXT
// code connect's propBindings may rename a figma prop to a code-side name
function computeSlots(dc: FigmaDesignContext, cc: FigmaCodeConnect): string[] {
  const props = dc.componentProperties ?? {};
  const bindings = cc.propBindings ?? {};
  const slots = new Set<string>();
  for (const [name, prop] of Object.entries(props)) {
    if (prop.type !== 'INSTANCE_SWAP' && prop.type !== 'TEXT') continue;
    const codeName = bindings[name] ?? name;
    slots.add(safePropName(normalizePropName(codeName)));
  }
  return Array.from(slots).sort();
}

// prefer the variable's human-readable name; otherwise fall back to a
// figmaVar.<sanitized-id> ref so the binding round-trips even when the
// mcp omitted the name field
function variableToTokenRef(ref: FigmaVariableRef): string {
  if (ref.name && ref.name.length > 0) {
    return normalizeTokenRef(ref.name);
  }
  const safeId = ref.id.replace(/[^a-zA-Z0-9_]/g, '_');
  return `figmaVar.${safeId}`;
}

// map first-fill and first-stroke variable bindings to background/borderColor;
// effect bindings populate shadow* props by source-key lookup
function mapPaintsToBindings(
  style: FigmaStyle
): Partial<Record<StyleProp, string>> {
  const bindings: Partial<Record<StyleProp, string>> = {};
  const fills = style.fills ?? [];
  const firstFill = fills[0];
  const fillColor = firstFill?.boundVariables?.['color'];
  if (fillColor) bindings.background = variableToTokenRef(fillColor);

  const strokes = style.strokes ?? [];
  const firstStroke = strokes[0];
  const strokeColor = firstStroke?.boundVariables?.['color'];
  if (strokeColor) bindings.borderColor = variableToTokenRef(strokeColor);

  const effectMap: Array<[string, StyleProp]> = [
    ['color', 'shadowColor'],
    ['offset', 'shadowOffset'],
    ['radius', 'shadowRadius'],
    ['spread', 'shadowOpacity'],
  ];
  const effects = style.effects ?? [];
  for (const eff of effects) {
    const bv = eff.boundVariables ?? {};
    for (const [src, prop] of effectMap) {
      const ref = bv[src];
      if (ref && bindings[prop] === undefined) {
        bindings[prop] = variableToTokenRef(ref);
      }
    }
  }

  return bindings;
}

// map numeric variable bindings (radius, stroke, padding, gap) to ir style
// props. paddingLeft/paddingTop drive paddingX/paddingY; right/bottom act as
// fallbacks so asymmetric padding still produces something usable
function mapNumericBindings(
  style: FigmaStyle
): Partial<Record<StyleProp, string>> {
  const bindings: Partial<Record<StyleProp, string>> = {};
  const bv = style.boundVariables ?? {};
  const direct: Array<[string, StyleProp]> = [
    ['cornerRadius', 'borderRadius'],
    ['strokeWeight', 'borderWidth'],
    ['paddingLeft', 'paddingX'],
    ['paddingTop', 'paddingY'],
    ['itemSpacing', 'gap'],
  ];
  for (const [src, prop] of direct) {
    const ref = bv[src];
    if (ref) bindings[prop] = variableToTokenRef(ref);
  }
  if (bindings.paddingX === undefined) {
    const right = bv['paddingRight'];
    if (right) bindings.paddingX = variableToTokenRef(right);
  }
  if (bindings.paddingY === undefined) {
    const bottom = bv['paddingBottom'];
    if (bottom) bindings.paddingY = variableToTokenRef(bottom);
  }
  return bindings;
}

// merge paint and numeric bindings into a single style-prop map
function mapStyleToBindings(
  style: FigmaStyle
): Partial<Record<StyleProp, string>> {
  return { ...mapPaintsToBindings(style), ...mapNumericBindings(style) };
}

// emit one unconditional rule from the root style plus per-variant rules
// rules whose bindings ended up empty are skipped to keep the ir clean
function computeStyles(dc: FigmaDesignContext): StyleRule[] {
  const rules: StyleRule[] = [];
  if (dc.style) {
    const bindings = mapStyleToBindings(dc.style);
    if (Object.keys(bindings).length > 0) {
      rules.push({ when: {}, bindings });
    }
  }
  for (const v of dc.variants ?? []) {
    if (!v.style) continue;
    const bindings = mapStyleToBindings(v.style);
    if (Object.keys(bindings).length === 0) continue;
    const when = variantSelectorFor(v);
    rules.push({ when, bindings });
  }
  return rules;
}

// pull semantics hints out of declared component properties (currently just
// the aria-label-from-prop association)
function computeSemantics(dc: FigmaDesignContext): Semantics {
  const semantics: Semantics = {};
  const props = dc.componentProperties;
  if (props) {
    for (const name of Object.keys(props)) {
      if (/^aria-?label/i.test(name)) {
        semantics.ariaLabelFromProp = safePropName(normalizePropName(name));
        break;
      }
    }
  }
  return semantics;
}

// camelCase the figma name and capitalize the first letter for a usable
// component identifier; fall back to the raw name when normalization is empty
function computeName(rawName: string): string {
  const normalized = normalizePropName(rawName);
  if (normalized.length === 0) return rawName;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// stitch together the designSource block, preferring dc.componentKey but
// falling back to the value reported by code connect
function buildDesignSource(
  dc: FigmaDesignContext,
  cc: FigmaCodeConnect
): DesignSource {
  const source: DesignSource = { tool: 'figma' };
  if (dc.fileKey !== undefined) source.fileKey = dc.fileKey;
  if (dc.id !== undefined) source.nodeId = dc.id;
  const componentKey = dc.componentKey ?? cc.componentKey;
  if (componentKey !== undefined) source.componentKey = componentKey;
  return source;
}

// translate the two figma mcp responses into a ComponentDefinition and
// validate it against the canonical schema before returning
export function figmaToComponent(
  designContext: unknown,
  codeConnect: unknown,
  opts: { codePath: string }
): ComponentDefinition {
  const dc = parseDesignContext(designContext);
  const cc = parseCodeConnect(codeConnect);

  const result: ComponentDefinition = {
    name: computeName(dc.name),
    codePath: opts.codePath,
    designSource: buildDesignSource(dc, cc),
    variants: computeVariantAxes(dc),
    slots: computeSlots(dc, cc),
    styles: computeStyles(dc),
    semantics: computeSemantics(dc),
  };

  const variantMappings = computeVariantMappings(cc);
  if (variantMappings) result.variantMappings = variantMappings;

  return ComponentDefinitionSchema.parse(result) as ComponentDefinition;
}
