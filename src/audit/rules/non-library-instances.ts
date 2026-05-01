// flag instances whose componentKey is not in the divebar mirror,
// catching components dragged in from outside the design system

import { defineRule } from '../define-rule';

export default defineRule({
  name: 'non-library-instances',
  test: ({ node, state }) => {
    if (node.type !== 'INSTANCE') return false;
    if (!node.componentKey) return false;
    const known = state['libraryKeys'] as Set<string> | undefined;
    if (!known) return false;
    return !known.has(node.componentKey);
  },
  message: ({ node }) =>
    `"${node.name}" instance component key not in divebar mirror`,
});
