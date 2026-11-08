// The MCP (Model Context Protocol) side of /mcp: JSON-RPC over HTTP POST, answered with plain JSON. Only what a tool
// server needs: initialize, ping, tools/list, tools/call. The tools are in
// lib/mcp-tools.js. ponytail: hand-written, no SDK, no SSE streams or sessions (the spec lets a server answer every
// POST with one JSON response). Add the SDK if resources or server pushes are ever needed.
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

// The JSON-RPC response for one message, or null for a notification (no id, nothing to answer).
export async function handle(msg, server, user) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  }
  if (msg.id === undefined) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': {
      const v = msg.params?.protocolVersion ?? '';
      return ok({ protocolVersion: VERSIONS.includes(v) ? v : VERSIONS[0], capabilities: { tools: {} },
        serverInfo: { name: server.name, version: '1.0.0' }, instructions: server.instructions });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: server.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !t.readOnly && !!t.destructive } })) });
    case 'tools/call': {
      const t = server.tools.find((x) => x.name === msg.params?.name);
      if (!t) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const r = await t.run(msg.params?.arguments ?? {}, user);
        return ok({ content: [{ type: 'text', text: r === undefined ? 'Done.' : typeof r === 'string' ? r : JSON.stringify(r) }] });
      } catch (e) {
        // A tool failure is a result the model can read and correct, not a protocol error.
        return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `Unknown method: ${msg.method}`);
  }
}
