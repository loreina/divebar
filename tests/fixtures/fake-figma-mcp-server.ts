// fake JSON-RPC 2.0 stdio server emitting realistic MCP content envelopes
// kept separate from fake-mcp-server.ts because the envelope shape differs
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

function envelope(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError };
}

function handle(msg: JsonRpcRequest): void {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'fake-figma-mcp', version: '0.0.0' },
      },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') return;

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'get_design_context' },
          { name: 'get_context_for_code_connect' },
          { name: 'use_figma' },
        ],
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const params = msg.params ?? {};
    const name = params['name'] as string | undefined;
    const args = (params['arguments'] as Record<string, unknown>) ?? {};

    if (name === 'get_design_context') {
      const text = JSON.stringify({
        hello: 'from get_design_context',
        url: args['url'],
      });
      send({ jsonrpc: '2.0', id: msg.id, result: envelope(text) });
      return;
    }

    if (name === 'get_context_for_code_connect') {
      const text = JSON.stringify({
        hello: 'from get_context_for_code_connect',
        url: args['url'],
      });
      send({ jsonrpc: '2.0', id: msg.id, result: envelope(text) });
      return;
    }

    if (name === 'use_figma') {
      const script = args['script'];
      if (script === 'FAIL') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: envelope('use_figma exploded on purpose', true),
        });
        return;
      }
      if (script === 'MALFORMED') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'not json' }] },
        });
        return;
      }
      if (script === 'BAD_ENVELOPE') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { result: 'no content array' },
        });
        return;
      }
      const text = JSON.stringify({ hello: 'from use_figma', script });
      send({ jsonrpc: '2.0', id: msg.id, result: envelope(text) });
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
        handle(JSON.parse(line) as JsonRpcRequest);
      } catch {
        // ignore malformed lines
      }
    }
    nl = buffer.indexOf('\n');
  }
}
