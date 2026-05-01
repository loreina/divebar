// `divebar inspect`: load a component's ir from its .divebar.json sidecar and
// rewrite codePath to point back at the file the user passed in

import { ComponentDefinitionSchema } from '../core/schema';
import { dirname, basename } from 'node:path';
import { readText, exists } from '../utils/io';
import type { ComponentDefinition } from '../core/types';

// reads a component's ir from its .divebar.json sidecar next to the code file
export async function runInspect(
  file: string,
  _root = process.cwd()
): Promise<string> {
  const sidecarPath = resolveSidecarPath(file);

  if (!(await exists(sidecarPath))) {
    throw new Error(
      `No .divebar.json sidecar found at ${sidecarPath}. ` +
        `Create one with the component IR, or run divebar bootstrap.`
    );
  }

  const ir = ComponentDefinitionSchema.parse(
    JSON.parse(await readText(sidecarPath))
  ) as unknown as ComponentDefinition;
  ir.codePath = file;
  return JSON.stringify(ir, null, 2);
}

// derive Foo.divebar.json from Foo.tsx (or jsx/ts/js) in the same directory
function resolveSidecarPath(codePath: string): string {
  const dir = dirname(codePath);
  const base = basename(codePath).replace(/\.(tsx?|jsx?)$/, '');
  return `${dir}/${base}.divebar.json`;
}
