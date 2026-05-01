// `divebar audit`: walk a figma frame, run every rule on each node, then
// finalize aggregates. produces a flat list of findings the cli formats

import { walkFigma } from '../adapters/figma/walk';
import { loadRules } from '../audit/registry';
import type {
  AuditRule,
  AuditFinding,
  RuleContext,
} from '../audit/define-rule';

// inputs to runAudit: file + root node, mcp client, and library knowledge
export interface RunAuditOpts {
  fileKey: string;
  rootNodeId: string;
  figma: {
    getMetadata: (input: {
      fileKey: string;
      nodeId?: string;
    }) => Promise<unknown[]>;
  };
  libraryNames?: Set<string>;
  libraryKeys?: Set<string>;
  rules?: AuditRule[];
  rulePatterns?: string[];
  root?: string;
}

// load rules, walk the subtree, collect per-node findings, then call each
// rule's finalize() so aggregating rules can emit batched findings
export async function runAudit(opts: RunAuditOpts): Promise<AuditFinding[]> {
  const rules =
    opts.rules ??
    (await loadRules({
      root: opts.root ?? process.cwd(),
      patterns: opts.rulePatterns ?? [],
    }));

  const findings: AuditFinding[] = [];
  const state: Record<string, any> = {
    libraryNames: opts.libraryNames,
    libraryKeys: opts.libraryKeys,
  };

  for await (const node of walkFigma({
    fileKey: opts.fileKey,
    rootNodeId: opts.rootNodeId,
    figma: opts.figma,
  })) {
    for (const rule of rules) {
      const ctx: RuleContext = { node, state };
      if (rule.test(ctx)) {
        findings.push({
          rule: rule.name,
          node: { id: node.id, name: node.name },
          message: rule.message(ctx),
        });
      }
    }
  }

  for (const rule of rules) {
    if (rule.finalize) {
      findings.push(...rule.finalize(state));
    }
  }

  return findings;
}

// pretty-print findings into the cli's audit output (or a success line)
export function formatFindings(findings: AuditFinding[]): string {
  if (findings.length === 0) return '✓ no audit findings';
  return findings.map((f) => `✗ ${f.rule.padEnd(22)} ${f.message}`).join('\n');
}
