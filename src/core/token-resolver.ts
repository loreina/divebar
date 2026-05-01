// resolve dot-path token references to concrete values. handles multi-mode
// tokens (picking the requested mode, the default mode, or the first mode
// found) and chases $alias links recursively

import type { TokenSet, TokenValue } from './types';
import { normalizeTokenRef } from '../utils/normalize';

// walk a dot-path ref through the token tree and return its resolved value
export function resolveTokenRef(
  tokens: TokenSet,
  ref: string,
  mode?: string
): TokenValue {
  const normalized = normalizeTokenRef(ref);
  const parts = normalized.split('.');
  let node: any = tokens.tokens;

  for (const p of parts) {
    if (!node || typeof node !== 'object') throw new Error(`bad ref ${ref}`);
    node = node[p];
  }

  if (!node || typeof node !== 'object') throw new Error(`unresolved ${ref}`);

  if ('$valuesByMode' in node && node.$valuesByMode) {
    const resolveMode =
      mode ?? tokens.defaultMode ?? Object.keys(node.$valuesByMode)[0];
    if (!resolveMode)
      throw new Error(`no mode specified for multi-mode token ${ref}`);
    const val = node.$valuesByMode[resolveMode];
    if (val === undefined)
      throw new Error(`mode ${resolveMode} not found for ${ref}`);
    if (val && typeof val === 'object' && '$alias' in val) {
      return resolveTokenRef(tokens, (val as any).$alias, mode);
    }
    return val as TokenValue;
  }

  if ('$value' in node) {
    const val = node.$value;
    if (val && typeof val === 'object' && '$alias' in val) {
      return resolveTokenRef(tokens, (val as any).$alias, mode);
    }
    return val as TokenValue;
  }

  throw new Error(`unresolved ${ref}`);
}

// resolve every ref in a bindings map to its concrete value
export function resolveAllTokenRefs(
  bindings: Record<string, string>,
  tokens: TokenSet,
  mode?: string
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [k, ref] of Object.entries(bindings)) {
    out[k] = String(resolveTokenRef(tokens, ref, mode));
  }

  return out;
}
