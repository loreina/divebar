// pure decision function for `divebar sync`: compare the locked hash triple
// to current figma + code hashes and pick which side (if any) to render

import type { HashTriple } from './lockfile';

// possible outcomes from a sync comparison
export type SyncDecision =
  | { kind: 'noop' }
  | { kind: 'render-code' } // figma changed → render code from new ir
  | { kind: 'render-figma' } // code changed → push ir to figma
  | { kind: 'render-both' } // first sync, no prior lock
  | { kind: 'conflict' }; // both sides drifted

// decide what sync action to take given locked and current hashes
export function decideSync(
  last: HashTriple | undefined,
  currentFigma: string,
  currentCode: string
): SyncDecision {
  if (!last) return { kind: 'render-both' };

  const figmaDrift = last.figmaHash !== currentFigma;
  const codeDrift = last.codeHash !== currentCode;

  if (!figmaDrift && !codeDrift) return { kind: 'noop' };
  if (figmaDrift && codeDrift) return { kind: 'conflict' };
  if (figmaDrift) return { kind: 'render-code' };

  return { kind: 'render-figma' };
}
