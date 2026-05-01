// pins the ModeInfo[] shape used by multi-mode token output. covers the
// folder-name keying of tokensByMode, modeIdByName emission, spec sidecar
// round-tripping, and the back-compat coercion of legacy string[] modes

import { test, expect } from 'bun:test';
import {
  renderTokens,
  renderTokensSpec,
  parseTokensSpec,
} from '../../src/core/token-parser';
import type { TokenSet, ModeInfo } from '../../src/core/types';

test('multi-mode render keys tokensByMode by folder name and emits modeIdByName', () => {
  const modes: ModeInfo[] = [
    { id: '5753:7', name: 'Consumer', folder: 'consumer' },
    { id: '5753:8', name: 'Consumer Dark', folder: 'consumerDark' },
  ];
  const ts: TokenSet = {
    modes,
    defaultMode: '5753:7',
    tokens: {
      bg: {
        $type: 'color',
        $valuesByMode: { '5753:7': '#FFFFFF', '5753:8': '#000000' },
      },
    },
  };

  const code = renderTokens(ts);
  expect(code).toContain('"consumer"');
  expect(code).toContain('"consumerDark"');
  // tokensByMode keys must use the friendly folder name, not the bare modeId
  expect(code).not.toContain('"5753:7":');
  expect(code).toContain('export const modeIdByName');
  expect(code).toMatch(/Consumer.*5753:7/);

  // legacy string[] modes still parse via back-compat
  const legacy = parseTokensSpec(
    JSON.stringify({
      modes: ['light', 'dark'],
      defaultMode: 'light',
      tokens: {},
    })
  );
  expect(legacy.modes?.[0]?.id).toBe('light');
  expect(legacy.modes?.[0]?.name).toBe('light');
  expect(legacy.modes?.[0]?.folder).toBe('light');
});

test('renderTokensSpec round-trips a ModeInfo[] TokenSet through parseTokensSpec', () => {
  const modes: ModeInfo[] = [
    { id: '5753:7', name: 'Consumer', folder: 'consumer' },
    { id: '5753:8', name: 'Consumer Dark', folder: 'consumerDark' },
  ];
  const ts: TokenSet = {
    modes,
    defaultMode: '5753:7',
    tokens: {
      bg: {
        $type: 'color',
        $valuesByMode: { '5753:7': '#FFFFFF', '5753:8': '#000000' },
      },
    },
  };
  const spec = renderTokensSpec(ts);
  const parsed = parseTokensSpec(spec);
  expect(parsed.modes).toEqual(modes);
  expect(parsed.defaultMode).toBe('5753:7');
  expect(parsed).toEqual(ts);
});

test('legacy string[] modes coerce to ModeInfo[] via TokenSetSchema', () => {
  const legacy = parseTokensSpec(
    JSON.stringify({
      modes: ['light', 'dark'],
      defaultMode: 'light',
      tokens: {
        bg: {
          $type: 'color',
          $valuesByMode: { light: '#FFF', dark: '#000' },
        },
      },
    })
  );
  expect(legacy.modes).toEqual([
    { id: 'light', name: 'light', folder: 'light' },
    { id: 'dark', name: 'dark', folder: 'dark' },
  ]);
});
