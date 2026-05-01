// flag solid fills that are not bound to a figma variable (raw hex colors)

import { defineRule } from '../define-rule';

export default defineRule({
  name: 'hardcoded-fills',
  test: ({ node }) =>
    Array.isArray(node.fills) &&
    node.fills.some((f) => f.type === 'SOLID' && !f.boundVariableId),
  message: ({ node }) => {
    const offender = (node.fills ?? []).find(
      (f) => f.type === 'SOLID' && !f.boundVariableId
    );
    const hex = offender?.color?.hex ?? '<unknown>';
    return `Frame "${node.name}" fill ${hex} - no token binding`;
  },
});
