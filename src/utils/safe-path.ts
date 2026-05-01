import { resolve, relative, isAbsolute } from 'node:path';

// join a relative path to root, throwing if it escapes the workspace
export function safeJoin(root: string, p: string): string {
  if (isAbsolute(p)) {
    throw new Error(
      `code-path must be relative to ${root}/divebar.json (got "${p}")`
    );
  }

  const abs = resolve(root, p);
  const rel = relative(root, abs);

  if (rel.startsWith('..')) {
    throw new Error(`code-path "${p}" resolves outside the workspace root`);
  }

  return abs;
}
