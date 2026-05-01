// `divebar registry` subcommands: add, list, remove component entries in
// divebar.json. all paths are validated through safeJoin to keep callers
// from escaping the workspace root

import {
  readRegistry,
  writeRegistry,
  addEntry,
  removeEntry,
  addEntryToWorkspace,
} from '../core/registry';
import { safeJoin } from '../utils/safe-path';

// inputs for `registry add`; framework/styling default to the registry's values
export interface RegAddOpts {
  name: string;
  irPath: string;
  framework?: 'react' | 'react-native';
  styling?: 'tailwind' | 'styled-components' | 'stylesheet';
  workspace?: string;
}

// add or update a component entry, writing to a workspace when one is given
export async function regAdd(
  opts: RegAddOpts,
  root = process.cwd()
): Promise<void> {
  safeJoin(root, opts.irPath);
  if (opts.workspace) {
    await addEntryToWorkspace(root, opts.workspace, opts);
  } else {
    const reg = await readRegistry(root);
    await writeRegistry(root, await addEntry(reg, opts));
  }
}

// render the registry as tab-separated rows. monorepo registries prefix each
// row with [workspace]; passing --workspace narrows the output to that one
export async function regList(
  root = process.cwd(),
  workspace?: string
): Promise<string> {
  const reg = await readRegistry(root);

  if (reg.workspaces && reg.workspaces.length > 0) {
    if (workspace) {
      const ws = reg.workspaces.find((w) => w.root === workspace);
      if (!ws) return '';
      return Object.entries(ws.components)
        .map(([name, e]) => `${name}\t${e.irPath}`)
        .join('\n');
    }
    const lines: string[] = [];
    for (const ws of reg.workspaces) {
      for (const [name, e] of Object.entries(ws.components)) {
        lines.push(`[${ws.root}] ${name}\t${e.irPath}`);
      }
    }
    return lines.join('\n');
  }

  return Object.entries(reg.components)
    .map(([name, e]) => `${name}\t${e.irPath}`)
    .join('\n');
}

// remove a component from a workspace (when given) or from the top-level entries
export async function regRemove(
  name: string,
  root = process.cwd(),
  workspace?: string
): Promise<void> {
  const reg = await readRegistry(root);

  if (workspace && reg.workspaces) {
    const wsIdx = reg.workspaces.findIndex((w) => w.root === workspace);
    if (wsIdx !== -1) {
      const { [name]: _, ...rest } = reg.workspaces[wsIdx]!.components;
      reg.workspaces[wsIdx]!.components = rest;
      await writeRegistry(root, reg);
      return;
    }
  }

  await writeRegistry(root, removeEntry(reg, name));
}
