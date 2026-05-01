// divebar.lock holds the last-known-good (figmaHash, codeHash, irHash) triple
// per component and per token set. owned exclusively by divebar sync; agents
// must not edit it by hand or drift detection silently breaks for everyone

import { z } from 'zod';
import { readJson, writeJson, exists } from '../utils/io';

// figma + code + ir hashes for one tracked entry
const HashTriple = z.object({
  figmaHash: z.string(),
  codeHash: z.string(),
  irHash: z.string(),
});

// top-level divebar.lock structure
const LockfileSchema = z.object({
  version: z.literal('1').default('1'),
  components: z.record(z.string(), HashTriple).default({}),
  tokens: z.record(z.string(), HashTriple).default({}),
});

export type Lockfile = z.infer<typeof LockfileSchema>;
export type HashTriple = z.infer<typeof HashTriple>;

const FILE = 'divebar.lock';

// load divebar.lock from root or return an empty lockfile
export async function readLockfile(root: string): Promise<Lockfile> {
  const path = `${root}/${FILE}`;
  if (!(await exists(path))) return LockfileSchema.parse({});
  return LockfileSchema.parse(await readJson(path));
}

// write the lockfile to divebar.lock
export async function writeLockfile(
  root: string,
  lock: Lockfile
): Promise<void> {
  await writeJson(`${root}/${FILE}`, lock);
}

// return a new lockfile with the named component's hash triple set
export function setComponentLock(
  lock: Lockfile,
  name: string,
  t: HashTriple
): Lockfile {
  return { ...lock, components: { ...lock.components, [name]: t } };
}

// return a new lockfile with the named token set's hash triple set
export function setTokenLock(
  lock: Lockfile,
  name: string,
  t: HashTriple
): Lockfile {
  return { ...lock, tokens: { ...lock.tokens, [name]: t } };
}
