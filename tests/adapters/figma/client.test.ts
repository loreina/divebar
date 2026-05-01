import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  startFigmaMcp,
  wrapFigmaMcp,
  type FigmaMcpClient,
} from '../../../src/adapters/figma/client';
import {
  startMcpClient,
  type McpClient,
  type McpTool,
} from '../../../src/adapters/figma/transport';

const FAKE_FIGMA: { command: string; args: string[] } = {
  command: 'bun',
  args: ['run', 'tests/fixtures/fake-figma-mcp-server.ts'],
};

interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

function makeMockClient(
  reply: unknown,
  recorded: RecordedCall[] = [],
  disposed: { count: number } = { count: 0 }
): McpClient {
  return {
    async listTools(): Promise<McpTool[]> {
      return [];
    },
    async callTool(name, args) {
      recorded.push({ name, args });
      return reply;
    },
    async dispose() {
      disposed.count += 1;
    },
  };
}

describe('FigmaMcpClient (typed wrapper)', () => {
  test('wrapFigmaMcp passes the right tool name and arg shape through', async () => {
    const recorded: RecordedCall[] = [];
    const mock = makeMockClient(
      { content: [{ type: 'text', text: '{"ok":true}' }], isError: false },
      recorded
    );
    const figma = wrapFigmaMcp(mock);
    await figma.getDesignContext('https://figma.com/file/abc');
    expect(recorded).toEqual([
      {
        name: 'get_design_context',
        args: { url: 'https://figma.com/file/abc' },
      },
    ]);
  });

  test('dispose forwards to the underlying McpClient.dispose', async () => {
    const disposed = { count: 0 };
    const mock = makeMockClient(
      { content: [{ type: 'text', text: '{}' }] },
      [],
      disposed
    );
    const figma = wrapFigmaMcp(mock);
    await figma.dispose();
    expect(disposed.count).toBe(1);
  });

  describe('against the fake Figma MCP server', () => {
    let figma: FigmaMcpClient | null = null;

    beforeEach(() => {
      figma = null;
    });

    afterEach(async () => {
      if (figma) {
        try {
          await figma.dispose();
        } catch {
          // some tests intentionally leave the server in an error state
        }
        figma = null;
      }
    });

    test('getDesignContext unwraps the envelope and parses the inner JSON', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      const result = await inner.getDesignContext('https://figma.com/file/xyz');
      expect(result).toEqual({
        hello: 'from get_design_context',
        url: 'https://figma.com/file/xyz',
      });
    });

    test('getContextForCodeConnect round-trips through the envelope', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      const result = await inner.getContextForCodeConnect(
        'https://figma.com/file/cc'
      );
      expect(result).toEqual({
        hello: 'from get_context_for_code_connect',
        url: 'https://figma.com/file/cc',
      });
    });

    test('useFigma round-trips through the envelope', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      const result = await inner.useFigma('console.log("ok")');
      expect(result).toEqual({
        hello: 'from use_figma',
        script: 'console.log("ok")',
      });
    });

    test('useFigma("FAIL") throws because isError is true and surfaces the error text', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      let caught: unknown;
      try {
        await inner.useFigma('FAIL');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('use_figma');
      expect((caught as Error).message).toContain(
        'use_figma exploded on purpose'
      );
    });

    test('useFigma("MALFORMED") throws a parse error mentioning the tool name', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      let caught: unknown;
      try {
        await inner.useFigma('MALFORMED');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('use_figma');
      expect((caught as Error).message.toLowerCase()).toContain('json');
    });

    test('useFigma("BAD_ENVELOPE") throws a schema-validation error mentioning content', async () => {
      const inner = wrapFigmaMcp(await startMcpClient(FAKE_FIGMA));
      figma = inner;
      let caught: unknown;
      try {
        await inner.useFigma('BAD_ENVELOPE');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('use_figma');
      expect((caught as Error).message).toContain('content');
    });

    test('startFigmaMcp end-to-end: spawn, three calls, dispose, process exits', async () => {
      const inner = await startFigmaMcp(FAKE_FIGMA);
      figma = inner;
      const a = await inner.getDesignContext('u1');
      const b = await inner.getContextForCodeConnect('u2');
      const c = await inner.useFigma('s3');
      expect(a).toEqual({ hello: 'from get_design_context', url: 'u1' });
      expect(b).toEqual({
        hello: 'from get_context_for_code_connect',
        url: 'u2',
      });
      expect(c).toEqual({ hello: 'from use_figma', script: 's3' });

      await inner.dispose();
      figma = null;

      // Calls after dispose should reject because the underlying transport is gone
      const after = await startFigmaMcp(FAKE_FIGMA);
      await after.dispose();
      let postDisposeCaught: unknown;
      try {
        await after.useFigma('whatever');
      } catch (err) {
        postDisposeCaught = err;
      }
      expect(postDisposeCaught).toBeInstanceOf(Error);
    });
  });
});

function fakeRawClient(responses: Record<string, unknown>): McpClient {
  return {
    listTools: async () => [],
    dispose: async () => {},
    callTool: async (name: string) => {
      if (!(name in responses)) throw new Error(`unexpected tool: ${name}`);
      return responses[name];
    },
  };
}

test('getMetadata calls the get_metadata tool with the file key', async () => {
  const figma = wrapFigmaMcp(
    fakeRawClient({
      get_metadata: [
        {
          id: '1:1',
          name: 'Tag',
          children: [{ id: '1:2', name: 'Size=Small' }],
        },
      ],
    })
  );
  const sets = await figma.getMetadata({ fileKey: 'abc' });
  expect(sets[0]?.id).toBe('1:1');
  expect(sets[0]?.children[0]?.name).toBe('Size=Small');
});

test('searchDesignSystem returns published key map', async () => {
  const figma = wrapFigmaMcp(
    fakeRawClient({
      search_design_system: [{ nodeId: '1:1', key: 'abc123' }],
    })
  );
  const keys = await figma.searchDesignSystem({ fileKey: 'abc' });
  expect(keys).toEqual([{ nodeId: '1:1', key: 'abc123' }]);
});

test('getMetadata throws when MCP returns an unexpected shape', async () => {
  const figma = wrapFigmaMcp(fakeRawClient({ get_metadata: { not: 'array' } }));
  await expect(figma.getMetadata({ fileKey: 'abc' })).rejects.toThrow();
});

test('getVariableDefs returns modes and variables arrays', async () => {
  const fixture = await Bun.file(
    'tests/fixtures/figma-mcp-variable-defs.json'
  ).json();
  const figma = wrapFigmaMcp(fakeRawClient({ get_variable_defs: fixture }));
  const got = await figma.getVariableDefs({
    fileKey: 'F',
    modes: ['Consumer', 'Consumer Dark'],
  });
  expect(got.modes).toHaveLength(2);
  expect(got.variables[0]?.name).toBe('color/brand/500');
});
