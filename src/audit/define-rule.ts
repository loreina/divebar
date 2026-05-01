// types and the defineRule helper used by every audit rule. the walker
// hands each rule a normalized figma node and a shared state bag so rules
// can also accumulate cross-node aggregates and emit them in finalize

import type { Mirror } from '../core/mirror-schema';
import type { TokenSet } from '../core/types';

// a flattened figma node shape that every rule sees, regardless of source
export interface NormalizedFigmaNode {
  id: string;
  name: string;
  type: string;
  fills?: Array<{
    type: string;
    color?: { hex: string };
    boundVariableId?: string;
  }>;
  componentKey?: string | null;
  variantProperties?: Record<string, string>;
  overrides?: Record<string, unknown>;
  children?: NormalizedFigmaNode[];
  parentId?: string;
}

// per-node context passed to test() and message(); state is shared across nodes
export interface RuleContext {
  node: NormalizedFigmaNode;
  state: Record<string, any>;
  mirror?: Mirror;
  tokens?: TokenSet;
}

// a single rule violation reported back to the user
export interface AuditFinding {
  rule: string;
  node: { id: string; name: string };
  message: string;
}

// a rule: per-node test + message, plus an optional finalize for aggregates
export interface AuditRule {
  name: string;
  test: (ctx: RuleContext) => boolean;
  message: (ctx: RuleContext) => string;
  finalize?: (state: Record<string, any>) => AuditFinding[];
}

// identity helper that exists for type inference at the call site
export function defineRule(rule: AuditRule): AuditRule {
  return rule;
}
