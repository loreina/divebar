// flag plain frames whose name matches a known library component, since they
// are usually instances that were detached and forked locally

import { defineRule } from '../define-rule';

export default defineRule({
  name: 'detached-instances',
  test: ({ node, state }) => {
    if (node.type !== 'FRAME') return false;
    const known = state['libraryNames'] as Set<string> | undefined;
    return !!known && known.has(node.name);
  },
  message: ({ node }) =>
    `"${node.name}" frame at ${node.id} is a FRAME, not an INSTANCE`,
});
