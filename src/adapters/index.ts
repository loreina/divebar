import type { ComponentAdapter } from './types';
import { reactStyledAdapter } from './react-styled';
import { reactNativeStyleSheetAdapter } from './react-native-stylesheet';

// all registered code adapters
const all: ComponentAdapter[] = [
  reactStyledAdapter,
  reactNativeStyleSheetAdapter,
];

// pick the adapter matching a framework+styling pair, or throw
export function selectAdapter(t: {
  framework: string;
  styling: string;
}): ComponentAdapter {
  const a = all.find(
    (a) => a.target.framework === t.framework && a.target.styling === t.styling
  );
  if (!a) {
    const installed = all.map(
      (a) => `${a.target.framework}+${a.target.styling}`
    );
    throw new Error(
      `no adapter for ${t.framework}+${t.styling}; installed: ${installed.join(', ')}`
    );
  }
  return a;
}

// return a copy of the installed adapter list
export function listInstalledAdapters(): ComponentAdapter[] {
  return [...all];
}
