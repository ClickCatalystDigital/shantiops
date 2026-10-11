// The database client for a Node server (Render, local dev). The Cloudflare Workers build swaps
// this file for db-client.workers.js (next.config.js, SB_TARGET=workers).
import { createClient } from '@libsql/client';
import { fetch as undiciFetch, Agent } from 'undici';

// hrana calls fetch(Request); undici's fetch needs the parts unpacked (different Request class).
async function tursoFetch(input, init) {
  if (typeof input === 'string' || input instanceof URL) return undiciFetch(input, { ...init, dispatcher: tursoAgent });
  const body = ['GET', 'HEAD'].includes(input.method) ? undefined : await input.text();
  return undiciFetch(input.url, { method: input.method, headers: input.headers, body, dispatcher: tursoAgent });
}
const tursoAgent = new Agent({ keepAliveTimeout: 1000, keepAliveMaxTimeout: 1000 });

export function makeClient() {
  if (process.env.TURSO_URL) {
    return createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      intMode: 'number',
      // Turso drops idle connections; the default fetch keeps them ~4s+ and then reuses a dead one
      // ("other side closed", UND_ERR_SOCKET). A short keep-alive means we reconnect instead.
      fetch: tursoFetch,
    });
  }
  return createClient({ url: 'file:./sb-ops-local.db', intMode: 'number' });
}
