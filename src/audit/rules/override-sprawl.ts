// flag component overrides that recur across the audited frame. test() runs
// per node and accumulates per-(component,key) counts in shared state under
// STATE_KEY; finalize() emits one finding for every key crossing THRESHOLD

import { defineRule, type AuditFinding } from '../define-rule';

// shared bucket name on the audit state object
const STATE_KEY = '__override_sprawl_counts';
// minimum recurrence before an override is reported
const THRESHOLD = 3;

interface CountEntry {
  count: number;
  sampleNodeId: string;
}
type Counts = Record<string, Record<string, CountEntry>>;

export default defineRule({
  name: 'override-sprawl',
  // increments counters; never emits a finding directly (always returns false)
  test: ({ node, state }) => {
    if (node.type !== 'INSTANCE' || !node.overrides) return false;
    const bucket: Counts = (state[STATE_KEY] ??= {} as Counts);
    const byKey: Record<string, CountEntry> = (bucket[node.name] ??= {});
    for (const k of Object.keys(node.overrides)) {
      const entry: CountEntry = (byKey[k] ??= {
        count: 0,
        sampleNodeId: node.id,
      });
      entry.count += 1;
    }
    return false;
  },
  message: () => '',
  // emit one finding per (component, key) pair that crossed THRESHOLD
  finalize: (state) => {
    const bucket = (state[STATE_KEY] as Counts | undefined) ?? {};
    const out: AuditFinding[] = [];
    for (const [comp, byKey] of Object.entries(bucket)) {
      for (const [key, entry] of Object.entries(byKey)) {
        if (entry.count >= THRESHOLD) {
          out.push({
            rule: 'override-sprawl',
            node: { id: entry.sampleNodeId, name: comp },
            message: `${comp}.${key} overridden ${entry.count} times across this frame`,
          });
        }
      }
    }
    return out;
  },
});
