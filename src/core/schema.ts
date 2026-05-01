// zod contracts for every .divebar.json sidecar shape (component ir + token
// set). hand-edited sidecars must round-trip through divebar parse so any
// drift from this schema fails loudly instead of being silently dropped

import { z } from 'zod';

// allowed style properties that ir bindings can target
const StyleProp = z.enum([
  'background',
  'foreground',
  'borderColor',
  'paddingX',
  'paddingY',
  'gap',
  'borderRadius',
  'borderWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'opacity',
  'elevation',
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
  'aspectRatio',
]);

// validate that a string is a dot-path or slash-path token reference
function isValidTokenRef(s: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/.test(s) ||
    /^[a-zA-Z][a-zA-Z0-9/_-]*$/.test(s)
  );
}

const TokenRef = z
  .string()
  .refine(isValidTokenRef, 'must be a token path or design-tool slash-name');

// a style rule: variant conditions → style prop bindings
export const StyleRuleSchema = z.object({
  when: z.record(z.string(), z.union([z.string(), z.boolean()])),
  bindings: z.record(StyleProp, TokenRef),
});

// tool-agnostic design source metadata for components
const DesignSourceSchema = z.object({
  tool: z.string(),
  fileKey: z.string().optional(),
  nodeId: z.string().optional(),
  componentKey: z.string().optional(),
});

// design source metadata for individual tokens
const TokenDesignSourceSchema = z.object({
  tool: z.string(),
  variableId: z.string().optional(),
});

// maps a code-side variant value to a design tool name
const VariantValueMappingSchema = z.object({
  code: z.union([z.string(), z.boolean()]),
  designName: z.string(),
});

// maps a code-side variant key + values to design tool names
const VariantMappingSchema = z.object({
  designName: z.string(),
  values: z.array(VariantValueMappingSchema),
});

// rule for excluding specific variant combos from generation
const ExcludeRuleSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()), z.boolean()])
);

// the main component ir schema
export const ComponentDefinitionSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  codePath: z.string().min(1),
  designSource: DesignSourceSchema.optional(),
  variants: z.record(
    z.string(),
    z.array(z.union([z.string(), z.boolean()])).min(1)
  ),
  variantMappings: z.record(z.string(), VariantMappingSchema).optional(),
  excludeWhen: z.array(ExcludeRuleSchema).optional(),
  slots: z.array(z.string()),
  styles: z.array(StyleRuleSchema),
  semantics: z.object({
    role: z
      .enum(['button', 'link', 'input', 'text', 'container', 'image'])
      .optional(),
    ariaLabelFromProp: z.string().optional(),
  }),
});

// allowed token types (w3c design tokens subset)
const TokenType = z.enum([
  'color',
  'dimension',
  'fontFamily',
  'fontWeight',
  'duration',
  'number',
  'string',
]);

// a token value is a raw string or number
const TokenValue = z.union([z.string(), z.number()]);

// an alias reference to another token
const TokenAlias = z.object({ $alias: z.string() });

const TokenValueOrAlias = z.union([TokenValue, TokenAlias]);

// a single design token with value, type, and optional design metadata
const TokenSchema = z
  .object({
    $value: TokenValueOrAlias.optional(),
    $valuesByMode: z.record(z.string(), TokenValueOrAlias).optional(),
    $type: TokenType,
    $description: z.string().optional(),
    designSource: TokenDesignSourceSchema.optional(),
    designName: z.string().optional(),
  })
  .refine(
    (t) => t.$value !== undefined || t.$valuesByMode !== undefined,
    'token must have either $value or $valuesByMode'
  );

// recursive token group — tokens nested arbitrarily
const TokenGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.record(z.string(), z.union([TokenSchema, TokenGroupSchema]))
);

// friendly mode metadata: figma id, display name, and safe folder name
const ModeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  folder: z.string(),
});

// accepts either the ModeInfo[] shape or a legacy string[] (back-compat)
// legacy string[] is coerced to ModeInfo[] with id == name == folder
const ModesSchema = z.union([
  z.array(ModeInfoSchema),
  z
    .array(z.string())
    .transform((arr) => arr.map((s) => ({ id: s, name: s, folder: s }))),
]);

// top-level token set schema with optional multi-mode support
export const TokenSetSchema = z.object({
  $schema: z.string().optional(),
  modes: ModesSchema.optional(),
  defaultMode: z.string().optional(),
  tokens: TokenGroupSchema,
});

export type ComponentDefinitionInput = z.infer<
  typeof ComponentDefinitionSchema
>;
export type TokenSetInput = z.infer<typeof TokenSetSchema>;
