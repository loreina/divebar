// serialize a value to json with sorted keys and $schema dropped
export function canonicalize(value: unknown): string {
  const sortKeys = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sortKeys);

    const out: Record<string, any> = {};
    for (const k of Object.keys(v)
      .filter((k) => k !== '$schema')
      .sort()) {
      out[k] = sortKeys(v[k]);
    }
    return out;
  };

  return JSON.stringify(sortKeys(value));
}
