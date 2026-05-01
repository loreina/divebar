// guess sensible defaults for a fresh divebar.json by inspecting package.json
// dependencies and the on-disk layout. used by `divebar init` so most users
// can answer the prompts with the suggested values

import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// detected defaults the init flow surfaces as suggested values
export interface FrameworkGuess {
  framework: 'react' | 'react-native';
  styling: 'styled-components' | 'stylesheet' | 'tailwind';
  outputDir: string;
  tokensPath: string;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// merged dependencies + devDependencies from package.json, empty on read failure
async function readDeps(root: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(root, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

// rules: react-native dep wins (forces stylesheet), then tailwindcss bumps
// styling to tailwind, otherwise default to react + styled-components
// outputDir + tokensPath are picked based on whether src/ already exists
export async function guessFramework(root: string): Promise<FrameworkGuess> {
  const deps = await readDeps(root);

  let framework: FrameworkGuess['framework'] = 'react';
  let styling: FrameworkGuess['styling'] = 'styled-components';

  if ('react-native' in deps) {
    framework = 'react-native';
    styling = 'stylesheet';
  } else if ('tailwindcss' in deps) {
    styling = 'tailwind';
  }

  const hasSrcComponents = await isDir(join(root, 'src', 'components'));
  const hasSrc = hasSrcComponents || (await isDir(join(root, 'src')));

  return {
    framework,
    styling,
    outputDir: hasSrcComponents ? 'src/components' : 'components',
    tokensPath: hasSrc ? 'src/tokens.ts' : 'tokens.ts',
  };
}
