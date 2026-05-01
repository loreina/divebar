// fake JSON-RPC 2.0 stdio server used by transport tests
// supports the minimum MCP handshake plus a few synthetic tools
export {};

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

function send(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendError(id: number, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function writeSplit(payload: string): Promise<void> {
  const half = Math.max(1, Math.floor(payload.length / 2));
  process.stdout.write(payload.slice(0, half));
  await Bun.sleep(30);
  process.stdout.write(payload.slice(half));
}

async function handle(msg: JsonRpcRequest): Promise<void> {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'fake-mcp', version: '0.0.0' },
      },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    return;
  }

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'echo' },
          { name: 'add' },
          { name: 'crash' },
          { name: 'slow_echo' },
        ],
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const params = msg.params ?? {};
    const name = params['name'] as string | undefined;
    const args = (params['arguments'] as Record<string, unknown>) ?? {};

    if (name === 'echo') {
      send({ jsonrpc: '2.0', id: msg.id, result: { echoed: args } });
      return;
    }

    if (name === 'add') {
      const a = Number(args['a'] ?? 0);
      const b = Number(args['b'] ?? 0);
      send({ jsonrpc: '2.0', id: msg.id, result: { sum: a + b } });
      return;
    }

    if (name === 'crash') {
      // exits without a reply, exercising the "MCP server exited" path
      process.exit(1);
    }

    if (name === 'slow_echo') {
      const payload =
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { echoed: args },
        }) + '\n';
      await writeSplit(payload);
      return;
    }

    if (msg.id !== undefined) {
      sendError(msg.id, -32601, `Tool not found: ${String(name)}`);
    }
    return;
  }

  if (msg.id !== undefined) {
    sendError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const decoder = new TextDecoder();
let buffer = '';

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let nl = buffer.indexOf('\n');
  while (nl !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim().length > 0) {
      try {
        const msg = JSON.parse(line) as JsonRpcRequest;
        await handle(msg);
      } catch {
        // ignore malformed lines; the real transport should never produce them
      }
    }
    nl = buffer.indexOf('\n');
  }
}
