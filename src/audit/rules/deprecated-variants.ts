// flag instances that pin a variant property to a value containing "deprecated"

import { defineRule } from '../define-rule';

export default defineRule({
  name: 'deprecated-variants',
  test: ({ node }) => {
    const props = node.variantProperties;
    if (!props) return false;
    return Object.values(props).some((v) =>
      String(v).toLowerCase().includes('deprecated')
    );
  },
  message: ({ node }) => {
    const props = node.variantProperties ?? {};
    const offenders = Object.entries(props)
      .filter(([, v]) => String(v).toLowerCase().includes('deprecated'))
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    return `${node.name} (${offenders}) @ ${node.id}`;
  },
});
