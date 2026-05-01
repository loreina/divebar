// generic json-rpc 2.0 stdio client used by every mcp integration
// one json object per line; outstanding requests tracked by numeric id

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  dispose(): Promise<void>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'divebar', version: '0.1.0' };

export async function startMcpClient(cfg: McpServerConfig): Promise<McpClient> {
  let proc: ChildProcessByStdio<Writable, Readable, Readable>;
  try {
    proc = spawn(cfg.command, cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(cfg.env ?? {}) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start MCP server '${cfg.command}': ${msg}`);
  }

  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  let exitError: Error | null = null;

  const fail = (err: Error): void => {
    if (!exitError) exitError = err;
    for (const call of pending.values()) call.reject(err);
    pending.clear();
  };

  proc.on('exit', (code) => {
    fail(
      new Error(
        `MCP server '${cfg.command}' exited (code: ${code ?? 'unknown'})`
      )
    );
  });

  proc.on('error', (err) => {
    fail(
      new Error(
        `MCP server '${cfg.command}' process error: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  });

  // background reader: buffer partial frames and dispatch by id
  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim().length > 0) handleLine(line);
      nl = buffer.indexOf('\n');
    }
  });
  proc.stdout.on('error', (err) => {
    fail(
      new Error(
        `MCP server '${cfg.command}' stdout stream error: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  });

  function handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!isJsonRpcResponse(msg)) return;
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if ('error' in msg) {
      call.reject(new Error(msg.error.message));
    } else {
      call.resolve(msg.result);
    }
  }

  function send(method: string, params?: unknown): Promise<unknown> {
    if (exitError) return Promise.reject(exitError);
    const id = nextId++;
    const frame: Record<string, unknown> = {
      jsonrpc: '2.0',
      id,
      method,
    };
    if (params !== undefined) frame['params'] = params;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        proc.stdin.write(JSON.stringify(frame) + '\n');
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function notify(method: string, params?: unknown): void {
    if (exitError) return;
    const frame: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) frame['params'] = params;
    try {
      proc.stdin.write(JSON.stringify(frame) + '\n');
    } catch {
      // notifications are best-effort; the next request surfaces the failure
    }
  }

  await send('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  notify('notifications/initialized');

  return {
    async listTools() {
      const result = (await send('tools/list')) as { tools?: McpTool[] };
      return result.tools ?? [];
    },
    async callTool(name, args) {
      return await send('tools/call', { name, arguments: args });
    },
    async dispose() {
      if (proc.exitCode === null) {
        try {
          proc.kill();
        } catch {
          // already gone
        }
      }
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.on('exit', () => resolve());
      });
    },
  };
}

function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m['jsonrpc'] !== '2.0') return false;
  if (typeof m['id'] !== 'number') return false;
  return 'result' in m || 'error' in m;
}
