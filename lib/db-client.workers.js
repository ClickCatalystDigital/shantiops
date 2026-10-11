// Cloudflare Workers build of db-client.js: libsql's web client on the runtime's own fetch
// (Workers manages connections itself). No filesystem, so Turso only.
import { createClient } from '@libsql/client/web';

export function makeClient() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL is required on Workers (no local SQLite)');
  return createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
}
