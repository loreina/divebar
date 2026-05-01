// content-addressable cache for figma fetches keyed on (fileKey, modes)
// modes are sorted before hashing so reordering doesn't invalidate the entry

import { readJson, writeJson, exists } from '../utils/io';

// inputs that uniquely identify a cached fetch
export interface CacheKeyInput {
  fileKey: string;
  modes: string[];
}

// hash (fileKey, sorted modes) into a stable cache key
export async function cacheKey(input: CacheKeyInput): Promise<string> {
  const sorted = [...input.modes].sort();
  const material = `${input.fileKey}\n${sorted.join('\n')}`;
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface CacheEntry {
  key: string;
  value: unknown;
}
interface CacheFile {
  entries: CacheEntry[];
}

// load the cache file at path, returning an empty store if missing
async function readCacheFile(path: string): Promise<CacheFile> {
  if (!(await exists(path))) return { entries: [] };
  return readJson<CacheFile>(path);
}

// look up a cached value by key; returns null on miss
export async function readCache<T>(
  path: string,
  key: string
): Promise<T | null> {
  const file = await readCacheFile(path);
  const hit = file.entries.find((e) => e.key === key);
  return hit ? (hit.value as T) : null;
}

// upsert a value at key, replacing any prior entry with the same key
export async function writeCache(
  path: string,
  key: string,
  value: unknown
): Promise<void> {
  const file = await readCacheFile(path);
  const without = file.entries.filter((e) => e.key !== key);
  without.push({ key, value });
  await writeJson(path, { entries: without });
}
