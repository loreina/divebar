// parse a figma variant name like "Kind=Primary, Size=Large" into a key/value
// map; segments without "=" are skipped, whitespace is trimmed
export function parseVariantName(name: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  
  for (const part of name.split(',')) {
    const eq = part.indexOf('=');

    if (eq === -1) continue;

    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    if (!key) continue;

    pairs[key] = value;
  }
  return pairs;
}

// collect distinct variant axis values across a component set's variants,
// preserving first-seen order so the resulting axes are deterministic
export function buildVariantProperties(
  children: Array<{ name: string }>
): Record<string, string[]> {
  const props: Record<string, string[]> = {};

  for (const child of children) {
    const pairs = parseVariantName(child.name);
    for (const [key, value] of Object.entries(pairs)) {
      if (!props[key]) props[key] = [];
      if (!props[key]!.includes(value)) props[key]!.push(value);
    }
  }
  
  return props;
}
