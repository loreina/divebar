// convert a slash/dash token path to camelCase
// "usage/color/background/default" → "usageColorBackgroundDefault"
// "base/color/neutral-0" → "baseColorNeutral0"
// "themeColorBackgroundDefault" → unchanged
// "color.brand.500" → unchanged (dot-path)
export function normalizeTokenRef(s: string): string {
  if (!/[/\-]/.test(s)) return s;
  return s
    .split(/[/\-]/)
    .map((seg, i) =>
      i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)
    )
    .join('');
}

// convert a design tool prop name to a valid camelCase identifier
// "Lead. Content" → "leadContent"
// "Size" → "size"
// "Has Icon?" → "hasIcon"
export function normalizePropName(designName: string): string {
  const cleaned = designName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .map((seg, i) =>
      i === 0
        ? seg.charAt(0).toLowerCase() + seg.slice(1)
        : seg.charAt(0).toUpperCase() + seg.slice(1)
    )
    .join('');
  return cleaned || 'unknown';
}

// props that conflict with react/rn builtins
const RESERVED_PROPS = new Set([
  'style',
  'className',
  'children',
  'ref',
  'key',
  'id',
  'class',
]);

// returns "variant" if the normalized name clashes with a reserved prop
export function safePropName(normalized: string): string {
  if (RESERVED_PROPS.has(normalized)) return 'variant';
  return normalized;
}
