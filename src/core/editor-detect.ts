// detect which editor (cursor, claude, codex) owns the project. project-local
// marker dirs win over the home directory; an unknown editor returns 'unknown'

import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// supported editors plus an explicit unknown sentinel
export type Editor = 'cursor' | 'claude' | 'codex' | 'unknown';

// resolved editor identity for the project root
export interface EditorPaths {
  editor: Editor;
}

// marker directory names checked in order; first hit wins
const EDITORS: ReadonlyArray<{
  editor: Exclude<Editor, 'unknown'>;
  marker: string;
}> = [
  { editor: 'cursor', marker: '.cursor' },
  { editor: 'claude', marker: '.claude' },
  { editor: 'codex', marker: '.codex' },
];

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// look for a marker dir at the project root first, then in the home directory
// returns 'unknown' when no editor marker is found at either location
export async function detectEditor(
  root: string,
  homeDir: string = homedir()
): Promise<EditorPaths> {
  for (const { editor, marker } of EDITORS) {
    if (await isDir(join(root, marker))) {
      return { editor };
    }
  }
  for (const { editor, marker } of EDITORS) {
    if (await isDir(join(homeDir, marker))) {
      return { editor };
    }
  }
  return { editor: 'unknown' };
}
