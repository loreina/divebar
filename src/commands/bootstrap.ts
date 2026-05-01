// `divebar bootstrap`: seed a .divebar.json sidecar from an existing component
// file by parsing its props interface, jsx tree, and type aliases. produces
// a starter ir with empty bindings the user fills in afterwards

import ts from 'typescript';
import { dirname, basename, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { glob } from 'glob';
import { readText, writeJson, exists } from '../utils/io';

export type BootstrapEmit = 'spec-sidecar' | 'props-cache';

export interface PropEntry {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: string | number | boolean;
}

export interface ComponentPropsCache {
  [componentName: string]: {
    codePath: string;
    props: PropEntry[];
  };
}

export interface BootstrapOpts {
  codePath: string;
  designTool?: string;
  designNodeId?: string;
  force?: boolean;
  root?: string;
  emit?: BootstrapEmit;
  outputPath?: string;
}

// dispatch on emit mode: existing sidecar emit, or new props-cache emit
export async function runBootstrap(opts: BootstrapOpts): Promise<string> {
  const emit = opts.emit ?? 'spec-sidecar';
  if (emit === 'props-cache') {
    return runPropsCacheEmit(opts);
  }
  return runSidecarEmit(opts);
}

// walk one file or a directory of components, write a single JSON cache of
// every <Name>Props interface keyed by component name
async function runPropsCacheEmit(opts: BootstrapOpts): Promise<string> {
  const out = opts.outputPath ?? `${opts.codePath}/props-cache.json`;
  const isDir = (await stat(opts.codePath)).isDirectory();
  const files = isDir
    ? await glob('**/*.{ts,tsx}', {
        cwd: opts.codePath,
        ignore: ['**/node_modules/**', '**/dist/**'],
        absolute: true,
      })
    : [opts.codePath];

  const cache: ComponentPropsCache = {};
  for (const file of files) {
    const source = await readText(file);
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const componentName = inferComponentName(sf, file);
    const propsInterface = findPropsInterface(sf, `${componentName}Props`);
    if (!propsInterface) continue;
    const defaults = extractDestructuringDefaults(sf, componentName);
    cache[componentName] = {
      codePath: file,
      props: extractPropsCache(sf, propsInterface, defaults),
    };
  }

  await writeJson(out, cache);
  return out;
}

// extract every property signature off a props interface as a plain entry.
// jsdoc descriptions are pulled via `getJSDocCommentsAndTags` (filtered to
// non-empty strings); destructuring defaults are merged in when present.
export function extractPropsCache(
  sf: ts.SourceFile,
  propsInterface: ts.InterfaceDeclaration,
  defaults: Record<string, string | number | boolean> = {}
): PropEntry[] {
  return propsInterface.members
    .filter(ts.isPropertySignature)
    .map((member) => {
      const name = member.name.getText(sf);
      const type = member.type ? member.type.getText(sf) : 'unknown';
      const required = !member.questionToken;
      const jsDoc = ts.getJSDocCommentsAndTags(member);
      const description = jsDoc
        .map((doc) => (doc as ts.JSDoc).comment ?? '')
        .filter((c): c is string => typeof c === 'string' && c.length > 0)
        .join(' ')
        .trim();
      const defaultVal = defaults[name];
      const entry: PropEntry = {
        name,
        type,
        required,
        ...(description ? { description } : {}),
        ...(defaultVal !== undefined ? { default: defaultVal } : {}),
      };
      return entry;
    });
}

// look at the component function's first parameter; if it destructures props
// with literal defaults (`{ disabled = false }`), return them keyed by name.
function extractDestructuringDefaults(
  sf: ts.SourceFile,
  componentName: string
): Record<string, string | number | boolean> {
  const defaults: Record<string, string | number | boolean> = {};
  const func = findComponentFunction(sf, componentName);
  if (!func) return defaults;
  const param = func.parameters[0];
  if (!param || !ts.isObjectBindingPattern(param.name)) return defaults;
  for (const element of param.name.elements) {
    if (!element.initializer) continue;
    let propName: string | null = null;
    if (element.propertyName && ts.isIdentifier(element.propertyName)) {
      propName = element.propertyName.text;
    } else if (ts.isIdentifier(element.name)) {
      propName = element.name.text;
    }
    if (!propName) continue;
    const literal = literalValue(element.initializer);
    if (literal !== undefined) defaults[propName] = literal;
  }
  return defaults;
}

function findComponentFunction(
  sf: ts.SourceFile,
  componentName: string
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      stmt.name.text === componentName
    ) {
      return stmt;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === componentName &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          return decl.initializer;
        }
      }
    }
  }
  return undefined;
}

function literalValue(
  expr: ts.Expression
): string | number | boolean | undefined {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

// parse the source, infer name + variants + slots + role, and write a sidecar
async function runSidecarEmit(opts: BootstrapOpts): Promise<string> {
  const root = opts.root ?? process.cwd();
  const source = await readText(opts.codePath);
  const sf = ts.createSourceFile(
    opts.codePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const componentName = inferComponentName(sf, opts.codePath);
  const propsInterface = findPropsInterface(sf, `${componentName}Props`);

  const extracted = propsInterface
    ? extractFromProps(sf, propsInterface)
    : { variants: {}, slots: [] };
  const jsxSlots = extractSlotsFromJsx(sf);
  const allSlots = [...new Set([...extracted.slots, ...jsxSlots])];
  const role = inferRoleFromRootElement(sf);

  const ir: any = {
    name: componentName,
    codePath: `./${basename(opts.codePath)}`,
    variants: extracted.variants,
    slots: allSlots,
    styles: [{ when: {}, bindings: {} }],
    semantics: { role },
  };

  if (opts.designTool) {
    ir.designSource = { tool: opts.designTool, nodeId: opts.designNodeId };
  }

  const sidecarPath = opts.codePath.replace(/\.(tsx?|jsx?)$/, '.divebar.json');

  if (!opts.force && (await exists(sidecarPath))) {
    throw new Error(`${sidecarPath} already exists. Use --force to overwrite.`);
  }

  await writeJson(sidecarPath, ir);
  return sidecarPath;
}

// pick the most likely component name. tries declarations in priority order:
// exported uppercase function, exported const arrow/function, function with
// matching filename, any uppercase function, default-exported identifier,
// and finally the file basename as a last resort
function inferComponentName(sf: ts.SourceFile, filePath: string): string {
  const fileBase = basename(filePath).replace(/\.(tsx?|jsx?)$/, '');

  // 1. exported function declaration with uppercase name
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      isUpperCase(stmt.name.text) &&
      hasExportModifier(stmt)
    ) {
      return stmt.name.text;
    }
  }

  // 2. exported `const Foo = () => ...` or `const Foo = function() {}`
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          isUpperCase(decl.name.text) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          return decl.name.text;
        }
      }
    }
  }

  // 3. uppercase function declaration matching the filename
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      stmt.name.text === fileBase
    ) {
      return stmt.name.text;
    }
  }

  // 4. any non-exported uppercase function declaration
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name &&
      isUpperCase(stmt.name.text)
    ) {
      return stmt.name.text;
    }
  }

  // 5. `export default <identifier>`
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      return stmt.expression.text;
    }
  }

  // 6. filename fallback
  return fileBase;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

// look up `${ComponentName}Props`, but only as an interface (type aliases are
// returned undefined to keep the extractor's logic simple)
function findPropsInterface(
  sf: ts.SourceFile,
  name: string
): ts.InterfaceDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return stmt;
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return undefined;
    }
  }
  return undefined;
}

interface PropsExtraction {
  variants: Record<string, (string | boolean)[]>;
  slots: string[];
}

const SLOT_TYPE_NAMES = new Set([
  'ReactNode',
  'React.ReactNode',
  'ReactElement',
  'React.ReactElement',
  'JSX.Element',
  'ComponentType',
  'React.ComponentType',
  'ImageSourcePropType',
  'ImageURISource',
  'Source',
]);

// props that are framework plumbing and should be skipped unless they have a finite variant union type
const SKIP_PROPS = new Set([
  'children',
  'style',
  'className',
  'testID',
  'accessibilityLabel',
]);

// classify each member of the props interface as either a variant (finite
// literal union or boolean) or a slot (react node, image source, plain string)
function extractFromProps(
  sf: ts.SourceFile,
  iface: ts.InterfaceDeclaration
): PropsExtraction {
  const variants: Record<string, (string | boolean)[]> = {};
  const slots: string[] = [];

  for (const member of iface.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const propName =
      member.name && ts.isIdentifier(member.name) ? member.name.text : null;
    if (!propName) continue;

    const literals = extractVariantLiterals(sf, member.type);

    // skip-listed props are only allowed through if they're a finite variant union
    if (SKIP_PROPS.has(propName)) {
      if (literals.length > 0) {
        variants[propName] = literals;
      }
      continue;
    }

    if (isSlotType(member.type)) {
      slots.push(propName);
      continue;
    }

    if (member.type.kind === ts.SyntaxKind.StringKeyword) {
      slots.push(propName);
      continue;
    }

    if (literals.length > 0) {
      variants[propName] = literals;
    }
  }

  return { variants, slots };
}

// extract variant literals from a type, following type aliases when needed
function extractVariantLiterals(
  sf: ts.SourceFile,
  type: ts.TypeNode
): (string | boolean)[] {
  let literals = extractStringLiterals(type);

  if (literals.length === 0 && ts.isTypeReferenceNode(type)) {
    const alias = resolveTypeAlias(sf, getTypeReferenceName(type));
    if (alias) literals = extractStringLiterals(alias.type);
  }

  return literals;
}

// look up a top-level `type Foo = ...` declaration by name
function resolveTypeAlias(
  sf: ts.SourceFile,
  name: string
): ts.TypeAliasDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) return stmt;
  }
  return undefined;
}

// produce a printable name like "React.ReactNode" from a type reference
function getTypeReferenceName(node: ts.TypeReferenceNode): string {
  if (ts.isIdentifier(node.typeName)) return node.typeName.text;
  return `${node.typeName.left.getText()}.${node.typeName.right.text}`;
}

// true when the type matches a known slot type, ComponentType<...>, or a union
// containing one
function isSlotType(type: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(type)) {
    const name = getTypeReferenceName(type);
    if (SLOT_TYPE_NAMES.has(name)) return true;
    const baseName = name.includes('.') ? name.split('.').pop()! : name;
    if (baseName === 'ComponentType') return true;
  }
  if (ts.isUnionTypeNode(type)) {
    return type.types.some((t) => isSlotType(t));
  }
  return false;
}

// extract literal variant values from a type node
// `BooleanKeyword` (`boolean`) -> [false, true] as booleans (figma boolean property)
// `"true" | "false"` string literal union -> ['true', 'false'] as strings (figma variant dropdown)
function extractStringLiterals(type: ts.TypeNode): (string | boolean)[] {
  if (ts.isUnionTypeNode(type)) {
    const literals: (string | boolean)[] = [];
    for (const t of type.types) {
      if (ts.isLiteralTypeNode(t)) {
        if (ts.isStringLiteral(t.literal)) {
          literals.push(t.literal.text);
        } else if (t.literal.kind === ts.SyntaxKind.TrueKeyword) {
          literals.push('true');
        } else if (t.literal.kind === ts.SyntaxKind.FalseKeyword) {
          literals.push('false');
        }
      }
    }
    return literals;
  }
  if (type.kind === ts.SyntaxKind.BooleanKeyword) {
    return [false, true];
  }
  return [];
}

// scan the jsx for `props.<name>` references and lift the obvious slot-y
// names (children, *text*, title/label/subtitle) into the slot list
function extractSlotsFromJsx(sf: ts.SourceFile): string[] {
  const slots = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'props'
      ) {
        const name = node.name.text;
        if (name === 'children' || isTextSlotName(name)) {
          slots.add(name);
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        if (
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'props'
        ) {
          const name = node.expression.name.text;
          if (isTextSlotName(name)) {
            slots.add(name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return Array.from(slots);
}

// look at the first jsx element a function declaration returns and map it to
// a semantic role; falls back to 'container' when nothing recognizable is hit
function inferRoleFromRootElement(sf: ts.SourceFile): string {
  let role = 'container';

  function visit(node: ts.Node): boolean {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = ts.isJsxElement(node)
        ? node.openingElement.tagName.getText()
        : node.tagName.getText();

      if (
        tagName === 'Pressable' ||
        tagName === 'TouchableOpacity' ||
        tagName === 'Button' ||
        tagName === 'button'
      ) {
        role = 'button';
      } else if (tagName === 'TextInput' || tagName === 'input') {
        role = 'input';
      } else if (
        tagName === 'Text' ||
        tagName === 'p' ||
        tagName === 'span' ||
        tagName === 'h1'
      ) {
        role = 'text';
      } else if (tagName === 'Image' || tagName === 'img') {
        role = 'image';
      } else if (tagName === 'a' || tagName === 'Link') {
        role = 'link';
      }
      return true;
    }
    return ts.forEachChild(node, visit) ?? false;
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      ts.forEachChild(stmt.body, (n) => {
        if (ts.isReturnStatement(n) && n.expression) {
          visit(n.expression);
        }
      });
    }
  }
  return role;
}

function isUpperCase(s: string): boolean {
  return (
    s.charAt(0) === s.charAt(0).toUpperCase() &&
    s.charAt(0) !== s.charAt(0).toLowerCase()
  );
}

function isTextSlotName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'title' ||
    lower === 'label' ||
    lower === 'subtitle' ||
    lower.includes('text')
  );
}
