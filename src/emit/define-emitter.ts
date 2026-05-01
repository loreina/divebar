// types and the defineEmitter helper used by every token emitter plugin

import type { TokenSet, ModeInfo } from '../core/types';

// one file produced by an emitter; the host writes it to disk verbatim
export interface EmittedFile {
  path: string;
  contents: string;
}

// inputs to emit(): the resolved token set, declared modes, and output root
export interface EmitContext {
  tokens: TokenSet;
  modes: ModeInfo[];
  outDir: string;
}

// an emitter plugin: a name plus a pure emit function returning files
export interface Emitter {
  name: string;
  emit: (ctx: EmitContext) => Promise<EmittedFile[]> | EmittedFile[];
}

// identity helper that exists for type inference at the call site
export function defineEmitter(emitter: Emitter): Emitter {
  return emitter;
}
