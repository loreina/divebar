import { test, expect } from 'bun:test';
import { safeJoin } from '../../src/utils/safe-path';

test('resolves relative paths', () => {
  const result = safeJoin('/project', 'src/Button.tsx');
  expect(result).toBe('/project/src/Button.tsx');
});

test('rejects absolute paths', () => {
  expect(() => safeJoin('/project', '/Users/me/app/Button.tsx')).toThrow('must be relative');
});

test('rejects paths that escape root', () => {
  expect(() => safeJoin('/project', '../../etc/passwd')).toThrow('outside the workspace root');
});
