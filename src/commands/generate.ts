// `divebar generate`: render a code file from an ir using the registry's
// adapter and token sidecar, writing output next to the ir

import { ComponentDefinitionSchema } from '../core/schema';
import { loadEffectiveRegistry, resolveTarget } from '../core/registry';
import { selectAdapter } from '../adapters';
import { parseTokensSpec } from '../core/token-parser';
import { safeJoin } from '../utils/safe-path';
import { readText, writeText, exists } from '../utils/io';
import type { ComponentDefinition } from '../core/types';

// load the ir, pick the framework+styling adapter, and write the code file
// returns the relative codePath the registry should track
export async function runGenerate(
  irPath: string,
  root = process.cwd(),
  workspace?: string
): Promise<string> {
  const ir = ComponentDefinitionSchema.parse(
    JSON.parse(await readText(irPath))
  ) as unknown as ComponentDefinition;
  const reg = await loadEffectiveRegistry(root, {
    name: ir.name,
    codePath: irPath,
    workspace,
  });
  const adapter = selectAdapter(resolveTarget(reg, ir.name));

  const tokens = await loadTokens(reg.root, reg.tokensPath, reg.tokensJsonPath);
  const code = adapter.render(ir, tokens, reg.theme ?? undefined);
  await writeText(safeJoin(reg.root, ir.codePath), code);
  return ir.codePath;
}

// load the spec sidecar next to tokens.ts, returning an empty set if missing
async function loadTokens(
  root: string,
  tokensPath: string,
  tokensJsonPath?: string
) {
  const specPath = tokensJsonPath
    ? safeJoin(root, tokensJsonPath)
    : safeJoin(root, tokensPath).replace(/\.ts$/, '.divebar.json');

  if (await exists(specPath)) {
    return parseTokensSpec(await readText(specPath));
  }
  return { tokens: {} };
}
