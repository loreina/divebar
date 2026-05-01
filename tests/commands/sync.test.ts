import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, runSyncCore } from '../../src/commands/sync';
import { writeRegistry, addEntry, readRegistry } from '../../src/core/registry';
import {
  writeLockfile,
  readLockfile,
  setComponentLock,
} from '../../src/core/lockfile';
import { renderTokensSpec } from '../../src/core/token-parser';
import { reactStyledAdapter } from '../../src/adapters/react-styled';
import { ButtonIR, ButtonTokens } from '../fixtures/button';
import type { FigmaMcpClient } from '../../src/adapters/figma/client';
import { hashIR } from '../../src/core/hash';

let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'spec-'));
  await writeRegistry(
    dir,
    await addEntry(await readRegistry(dir), {
      name: 'Button',
      irPath: 'Button.divebar.json',
    })
  );
  // sync reads codePath off the sidecar, so the IR write must happen here
  await Bun.write(
    `${dir}/Button.divebar.json`,
    JSON.stringify({ ...ButtonIR, codePath: 'Button.tsx' })
  );
  await Bun.write(`${dir}/src/tokens.divebar.json`, renderTokensSpec(ButtonTokens));
});

async function sha(s: string) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

test('noop when nothing has changed', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  await Bun.write(`${dir}/Button.tsx`, code);
  const codeHash = await sha(code);
  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: 'F',
      codeHash,
      irHash: 'I',
    })
  );
  const out = await runSync({ name: 'Button', figmaHash: 'F', root: dir });
  expect(out.decision).toBe('noop');
});

test('conflict when both sides drifted', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  await Bun.write(`${dir}/Button.tsx`, code + '\n// hand edit');
  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: 'F',
      codeHash: 'OLD',
      irHash: 'I',
    })
  );
  const out = await runSync({ name: 'Button', figmaHash: 'F2', root: dir });
  expect(out.decision).toBe('conflict');
  expect(out.message).toContain('Reset one side');
});

test('render-figma when only code drifted', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  const codeHash = await sha(code);
  await Bun.write(`${dir}/Button.tsx`, code);
  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: 'F',
      codeHash: 'OLD',
      irHash: 'I',
    })
  );
  const out = await runSync({ name: 'Button', figmaHash: 'F', root: dir });
  expect(out.decision).toBe('render-figma');
  expect(out.figmaScript).toContain('createComponent');
  const newLock = await readLockfile(dir);
  expect(newLock.components.Button!.codeHash).toBe(codeHash);
});

test('render-code when only Figma drifted', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  await Bun.write(`${dir}/Button.tsx`, code);
  const codeHash = await sha(code);
  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: 'F',
      codeHash,
      irHash: 'I',
    })
  );
  await Bun.write(
    `${dir}/ir.json`,
    JSON.stringify({ ...ButtonIR, codePath: 'Button.tsx' })
  );
  const out = await runSync({
    name: 'Button',
    figmaHash: 'F2',
    figmaIRPath: `${dir}/ir.json`,
    root: dir,
  });
  expect(out.decision).toBe('render-code');
  const written = await Bun.file(`${dir}/Button.tsx`).text();
  expect(written).toContain('export function Button');
});

function fakeFigma(opts: {
  onGetDesignContext?: (url: string) => unknown;
}): FigmaMcpClient {
  return {
    getDesignContext: async (url) =>
      opts.onGetDesignContext
        ? opts.onGetDesignContext(url)
        : { id: '1:23', name: 'Button' },
    getContextForCodeConnect: async () => null,
    useFigma: async () => null,
    getMetadata: async () => [],
    searchDesignSystem: async () => [],
    getVariableDefs: async () => ({ modes: [], variables: [] }),
    dispose: async () => {},
  };
}

test('runSyncCore re-fetches the figma hash via MCP when figmaHash is omitted', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  await Bun.write(`${dir}/Button.tsx`, code);
  const codeHash = await sha(code);

  const designContext = { id: '1:23', name: 'Button' };
  const expectedHash = await hashIR(designContext);

  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: expectedHash,
      codeHash,
      irHash: 'I',
    })
  );

  const out = await runSyncCore({
    name: 'Button',
    root: dir,
    figma: fakeFigma({ onGetDesignContext: () => designContext }),
  });

  expect(out.computedFigmaHash).toBe(expectedHash);
});

test('runSyncCore builds the figma URL from designSource when re-fetching', async () => {
  const code = reactStyledAdapter.render(ButtonIR, ButtonTokens);
  await Bun.write(`${dir}/Button.tsx`, code);
  const codeHash = await sha(code);

  const designContext = { id: '1:23', name: 'Button' };
  const expectedHash = await hashIR(designContext);

  await writeLockfile(
    dir,
    setComponentLock(await readLockfile(dir), 'Button', {
      figmaHash: expectedHash,
      codeHash,
      irHash: 'I',
    })
  );

  const seen: string[] = [];
  await runSyncCore({
    name: 'Button',
    root: dir,
    figma: fakeFigma({
      onGetDesignContext: (url) => {
        seen.push(url);
        return designContext;
      },
    }),
  });

  const ds = ButtonIR.designSource!;
  const expected = `https://www.figma.com/design/${ds.fileKey}/file?node-id=${ds.nodeId!.replace(
    /:/g,
    '-'
  )}`;
  expect(seen).toEqual([expected]);
});

test('runSyncCore errors when both figmaHash and figma are missing', async () => {
  await expect(
    runSyncCore({ name: 'Button', root: dir, figma: null })
  ).rejects.toThrow(/sync requires either --figma-hash or a Figma MCP client/);
});

test('runSyncCore errors when IR has no designSource.fileKey', async () => {
  const irNoDS = {
    name: 'Button',
    codePath: 'Button.tsx',
    variants: ButtonIR.variants,
    slots: ButtonIR.slots,
    styles: ButtonIR.styles,
    semantics: ButtonIR.semantics,
  };
  await Bun.write(`${dir}/Button.divebar.json`, JSON.stringify(irNoDS));

  let called = false;
  await expect(
    runSyncCore({
      name: 'Button',
      root: dir,
      figma: fakeFigma({
        onGetDesignContext: () => {
          called = true;
          return {};
        },
      }),
    })
  ).rejects.toThrow(/has no designSource\.fileKey in its spec/);
  expect(called).toBe(false);
});

test('runSync (production) throws when divebar.json has no mcp.figma config', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'spec-sync-prod-'));
  const prevCwd = process.cwd();
  try {
    await writeRegistry(
      dir2,
      await addEntry(await readRegistry(dir2), {
        name: 'Button',
        irPath: 'Button.divebar.json',
      })
    );
    await Bun.write(
      `${dir2}/Button.divebar.json`,
      JSON.stringify({ ...ButtonIR, codePath: 'Button.tsx' })
    );
    process.chdir(dir2);
    await expect(runSync({ name: 'Button' })).rejects.toThrow(
      /divebar\.json has no mcp\.figma config/
    );
  } finally {
    process.chdir(prevCwd);
    await rm(dir2, { recursive: true, force: true });
  }
});
