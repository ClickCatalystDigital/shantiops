// "Connect Claude / ChatGPT": the MCP sign-in (OAuth 2.1 with PKCE and dynamic client registration, as the MCP spec
// asks). An AI app is pointed at <origin>/mcp, finds this server through /.well-known/*, registers itself, sends the
// person to /oauth/authorize (their normal login, then Allow), and swaps the one-time code for tokens at /oauth/token.
// A connection is an api_keys row (the access token's hash, an expiry, a refresh token's hash), so Settings lists and
// disconnects it, and /mcp (app/mcp/route.js) accepts it. Off in the public demo. (Ported from Designer Ops.)
import { createHash, randomBytes } from 'node:crypto';
import { queryOne, execute } from './db';

export const ACCESS_TTL = 7 * 864e5; // a week; the app refreshes quietly, so a connection stays until disconnected
const CODE_TTL = 5 * 60e3;
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const token = (prefix) => `${prefix}_${randomBytes(24).toString('base64url')}`;

// The public address, behind Render's or Cloudflare's proxy too.
export function originOf(req) {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]}://${host}`;
}

export const authServerMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['assistant'],
});
export const resourceMetadata = (origin) => ({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['assistant'], bearer_methods_supported: ['header'] });

// Redirect addresses an AI app may register: https anywhere, http only on this machine (local MCP clients).
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)); } catch { return false; } };

export async function registerClient(body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (!uris.length || !uris.every(okRedirect)) throw Object.assign(new Error('redirect_uris must be https (or http on localhost)'), { code: 'invalid_redirect_uri' });
  const clientId = token('sboc');
  const name = String(body.client_name || 'AI app').slice(0, 60);
  await execute('INSERT INTO oauth_clients (client_id, name, redirect_uris) VALUES (?, ?, ?)', [clientId, name, JSON.stringify(uris)]);
  return { client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
}

export async function getClient(clientId) {
  const c = await queryOne('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?', [String(clientId || '')]);
  return c ? { ...c, redirect_uris: JSON.parse(c.redirect_uris) } : null;
}

// Checks an /oauth/authorize request; returns the client or throws a message to show the person.
export async function checkAuthorize(p) {
  const client = await getClient(p.client_id);
  if (!client) throw new Error('This app is not registered here. Remove the connector in the AI app and add it again.');
  if (!client.redirect_uris.includes(p.redirect_uri)) throw new Error('The app sent an address it did not register.');
  if (p.response_type !== 'code') throw new Error('Unsupported response_type.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') throw new Error('The app must use PKCE (S256).');
  return client;
}

export async function createCode({ client_id, username, redirect_uri, code_challenge }) {
  const code = token('sbog');
  await execute('INSERT INTO oauth_codes (code_hash, client_id, username, redirect_uri, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha(code), client_id, username, redirect_uri, code_challenge, Date.now() + CODE_TTL]);
  return code;
}

async function issue(row) {
  const access = token('sboa'), refresh = token('sbor');
  const expires = Date.now() + ACCESS_TTL;
  if (row.id) await execute('UPDATE api_keys SET hash = ?, refresh_hash = ?, expires_at = ? WHERE id = ?', [sha(access), sha(refresh), expires, row.id]);
  else await execute('INSERT INTO api_keys (username, name, hash, client_id, expires_at, refresh_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [row.username, row.name, sha(access), row.client_id, expires, sha(refresh)]);
  return { access_token: access, token_type: 'Bearer', expires_in: Math.round(ACCESS_TTL / 1000), refresh_token: refresh, scope: 'assistant' };
}

const fail = (error, description) => Object.assign(new Error(description || error), { oauth: error });

export async function exchange(p) {
  if (p.grant_type === 'authorization_code') {
    const c = await queryOne('SELECT * FROM oauth_codes WHERE code_hash = ?', [sha(p.code || '')]);
    if (c) await execute('DELETE FROM oauth_codes WHERE code_hash = ?', [c.code_hash]); // one use only
    if (!c || c.expires_at < Date.now()) throw fail('invalid_grant', 'The code is invalid or expired');
    if (c.client_id !== p.client_id || c.redirect_uri !== p.redirect_uri) throw fail('invalid_grant', 'The code was issued to another app or address');
    const verifier = String(p.code_verifier || '');
    if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) throw fail('invalid_grant', 'PKCE check failed');
    const user = await queryOne('SELECT username FROM users WHERE username = ? AND active = 1', [c.username]);
    if (!user) throw fail('invalid_grant', 'That login is no longer active');
    const client = await getClient(c.client_id);
    return issue({ username: c.username, client_id: c.client_id, name: client?.name || 'AI app' });
  }
  if (p.grant_type === 'refresh_token') {
    const row = await queryOne('SELECT id, username, client_id, name FROM api_keys WHERE refresh_hash = ? AND revoked = 0', [sha(p.refresh_token || '')]);
    if (!row || (p.client_id && row.client_id !== p.client_id)) throw fail('invalid_grant', 'The refresh token is invalid or the connection was removed');
    return issue(row); // rotates both tokens on the same connection
  }
  throw fail('unsupported_grant_type');
}
