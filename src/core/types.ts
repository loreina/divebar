// public type surface for the divebar ir: framework targets, design-source
// metadata, the dtcg-flavored TokenSet, and the ComponentDefinition that
// adapters consume. mirrors the zod contracts in core/schema.ts

// supported ui frameworks
export type Framework = 'react' | 'react-native';

// supported styling approaches
export type Styling = 'tailwind' | 'styled-components' | 'stylesheet';

// framework + styling pair that identifies an adapter
export interface FrameworkTarget {
  framework: Framework;
  styling: Styling;
}

// ----- design source (tool-agnostic) -----

// metadata linking a component to a design tool node
export interface DesignSource {
  tool: string;
  fileKey?: string;
  nodeId?: string;
  componentKey?: string;
}

// metadata linking a token to a design tool variable
export interface TokenDesignSource {
  tool: string;
  variableId?: string;
}

// ----- token set (w3c design tokens subset, multi-mode) -----

// supported token value types
export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'duration'
  | 'number'
  | 'string';

// a resolved token value
export type TokenValue = string | number;

// a single design token
export interface Token {
  $value?: TokenValue | { $alias: string };
  $valuesByMode?: Record<string, TokenValue | { $alias: string }>;
  $type: TokenType;
  $description?: string;
  designSource?: TokenDesignSource;
  designName?: string;
}

// recursive group of tokens
export interface TokenGroup {
  [key: string]: Token | TokenGroup;
}

// friendly mode metadata: figma id, display name, and safe folder name
export interface ModeInfo {
  id: string;
  name: string;
  folder: string;
}

// a complete token collection with optional mode support
export interface TokenSet {
  $schema?: string;
  modes?: ModeInfo[];
  defaultMode?: string;
  tokens: TokenGroup;
}

// ----- component definition -----

// a variant value can be a string literal or boolean
export type VariantValue = string | boolean;

// maps variant keys to their possible values
export type VariantAxes = Record<string, VariantValue[]>;

// a specific variant combination
export type VariantSelector = Record<string, VariantValue>;

// style properties that adapters can bind tokens to
export type StyleProp =
  | 'background'
  | 'foreground'
  | 'borderColor'
  | 'paddingX'
  | 'paddingY'
  | 'gap'
  | 'borderRadius'
  | 'borderWidth'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'opacity'
  | 'elevation'
  | 'shadowColor'
  | 'shadowOffset'
  | 'shadowOpacity'
  | 'shadowRadius'
  | 'aspectRatio';

// a dot-path reference to a token
export type TokenRef = string;

// a conditional binding: when these variants match, bind these tokens
export interface StyleRule {
  when: VariantSelector;
  bindings: Partial<Record<StyleProp, TokenRef>>;
}

// accessibility and semantic role hints
export interface Semantics {
  role?: 'button' | 'link' | 'input' | 'text' | 'container' | 'image';
  ariaLabelFromProp?: string;
}

// maps a code-side variant value to a design tool name
export interface VariantValueMapping {
  code: string | boolean;
  designName: string;
}

// maps a code-side variant key + values to design tool names
export interface VariantMapping {
  designName: string;
  values: VariantValueMapping[];
}

// rule for excluding specific variant combos from generation
export interface ExcludeRule {
  [variantKey: string]: string | string[] | boolean;
}

// the main component intermediate representation
export interface ComponentDefinition {
  $schema?: string;
  name: string;
  codePath: string;
  designSource?: DesignSource;
  variants: VariantAxes;
  variantMappings?: Record<string, VariantMapping>;
  excludeWhen?: ExcludeRule[];
  slots: string[];
  styles: StyleRule[];
  semantics: Semantics;
}
