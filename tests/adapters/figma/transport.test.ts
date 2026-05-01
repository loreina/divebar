import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  startMcpClient,
  type McpClient,
} from '../../../src/adapters/figma/transport';

const FAKE_SERVER: { command: string; args: string[] } = {
  command: 'bun',
  args: ['run', 'tests/fixtures/fake-mcp-server.ts'],
};

describe('McpClient (JSON-RPC 2.0 stdio transport)', () => {
  let client: McpClient | null = null;

  beforeEach(() => {
    client = null;
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.dispose();
      } catch {
        // tests that crash the server are allowed to leave the client closed
      }
      client = null;
    }
  });

  test('startMcpClient resolves once the initialize handshake completes', async () => {
    client = await startMcpClient(FAKE_SERVER);
    expect(typeof client.listTools).toBe('function');
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.dispose).toBe('function');
  });

  test('listTools returns the fake server tool list', async () => {
    client = await startMcpClient(FAKE_SERVER);
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['add', 'crash', 'echo', 'slow_echo']);
  });

  test('callTool echo returns echoed args', async () => {
    client = await startMcpClient(FAKE_SERVER);
    const result = await client.callTool('echo', { msg: 'hi' });
    expect(result).toEqual({ echoed: { msg: 'hi' } });
  });

  test('callTool add returns the sum', async () => {
    client = await startMcpClient(FAKE_SERVER);
    const result = await client.callTool('add', { a: 2, b: 3 });
    expect(result).toEqual({ sum: 5 });
  });

  test('callTool with an unknown name surfaces the server error message', async () => {
    client = await startMcpClient(FAKE_SERVER);
    let caught: unknown;
    try {
      await client.callTool('nonexistent', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('Tool not found');
    expect((caught as Error).message).toContain('nonexistent');
  });

  test('subsequent calls reject with "MCP server exited" after the child crashes', async () => {
    client = await startMcpClient(FAKE_SERVER);
    await expect(client.callTool('crash', {})).rejects.toThrow(/exited/i);

    await expect(client.callTool('echo', { msg: 'hi' })).rejects.toThrow(
      /MCP server.*exited/i
    );
  });

  test('dispose kills the process and resolves', async () => {
    client = await startMcpClient(FAKE_SERVER);
    const t0 = Date.now();
    await client.dispose();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000);

    await expect(client.callTool('echo', { msg: 'hi' })).rejects.toThrow(
      /exited/i
    );
    client = null;
  });

  test('handles JSON frames split across multiple stdout chunks', async () => {
    client = await startMcpClient(FAKE_SERVER);
    const result = await client.callTool('slow_echo', { msg: 'partial' });
    expect(result).toEqual({ echoed: { msg: 'partial' } });
  });

  test('startMcpClient surfaces a friendly error for an unstartable command', async () => {
    let caught: unknown;
    try {
      await startMcpClient({
        command: '/nonexistent/divebar-fake-binary-does-not-exist',
        args: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(
      '/nonexistent/divebar-fake-binary-does-not-exist'
    );
  });
});
