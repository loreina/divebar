// `divebar parse`: validate a component ir json and re-emit it canonical form

import { ComponentDefinitionSchema } from '../core/schema';

// parse + revalidate the ir, producing a deterministic pretty-printed string
export async function runParse(input: string): Promise<string> {
  const obj = JSON.parse(input);
  const ir = ComponentDefinitionSchema.parse(obj);
  return JSON.stringify(ir, null, 2);
}
