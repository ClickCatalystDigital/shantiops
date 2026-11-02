// lib/quickbooks.js — QuickBooks Online connection, server side (OAuth 2.0 authorization code,
// token refresh, revoke, read calls). Pure parts and doc sources: lib/quickbooks.mjs.
//
// Where the connection lives: one JSON record per company, {realm_id, environment, tokens
// (encrypted with lib/crypto.js), expiries, status, account_map, ...}.
//   - Public demo (DEMO_MODE=1): in the demo's own R2 bucket (binding DEMO_FILES), key
//     quickbooks/<site host>/<company>.json, because the demo database is rebuilt every night and Intuit hands
//     back a new refresh token on every refresh. Conditional put (etag) keeps two refreshes from
//     overwriting each other.
//   - Everywhere else: table qbo_connections (company, data, version), same compare-and-set on version.
//
// Turned on only with QBO_CLIENT_ID + QBO_CLIENT_SECRET set and the US build (MARKET=NA). Not on
// the India deployment, which keeps Tally.
import { execute, queryOne } from './db';
import { encryptSecret, decryptSecret } from './crypto';
import { QBO_TOKEN_URL, QBO_REVOKE_URL, QBO_API_BASE, QBO_MINOR_VERSION, tokenTimes, needsRefresh } from './quickbooks.mjs';

const isDemo = () => process.env.DEMO_MODE === '1';

export function qboConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const market = process.env.MARKET || process.env.NEXT_PUBLIC_MARKET;
  if (!clientId || !clientSecret || !['NA', 'US'].includes(market)) return null;
  const environment = process.env.QBO_ENV === 'production' ? 'production' : 'sandbox';
  return { clientId, clientSecret, environment };
}

export function redirectUri(req) {
  if (process.env.QBO_REDIRECT_URI) return process.env.QBO_REDIRECT_URI;
  const base = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  return `${base}/api/quickbooks/callback`;
}

// ---------- storage ----------
function demoBucket() {
  const bucket = globalThis[Symbol.for('__cloudflare-context__')]?.env?.DEMO_FILES;
  if (!bucket) throw new Error('Demo storage is not set up');
  return bucket;
}
// The India and US demos share one bucket: the site's host keeps their records apart.
const r2Key = company => {
  let host = 'local';
  try { host = new URL(process.env.APP_URL).host; } catch { /* no APP_URL */ }
  return `quickbooks/${host}/${encodeURIComponent(company)}.json`;
};

// Returns {data, version} or null. version = R2 etag or the table's version column.
async function loadRecord(company) {
  if (isDemo()) {
    const obj = await demoBucket().get(r2Key(company));
    return obj ? { data: JSON.parse(await obj.text()), version: obj.etag } : null;
  }
  const row = await queryOne('SELECT data, version FROM qbo_connections WHERE company = ?', [company]);
  return row ? { data: JSON.parse(row.data), version: row.version } : null;
}

// Saves only if nobody changed the record since `version` was read (null = must not exist yet,
// undefined = overwrite). Returns false when someone else got there first.
async function saveRecord(company, data, version) {
  const body = JSON.stringify(data);
  if (isDemo()) {
    const opts = { httpMetadata: { contentType: 'application/json' } };
    if (version) opts.onlyIf = { etagMatches: version };
    const put = await demoBucket().put(r2Key(company), body, opts);
    return !!put;
  }
  if (version === undefined) {
    await execute(`INSERT INTO qbo_connections (company, data, version) VALUES (?, ?, 1)
                   ON CONFLICT(company) DO UPDATE SET data = excluded.data, version = qbo_connections.version + 1,
                   updated_at = CURRENT_TIMESTAMP`, [company, body]);
    return true;
  }
  if (version === null) {
    const r = await execute('INSERT OR IGNORE INTO qbo_connections (company, data, version) VALUES (?, ?, 1)', [company, body]);
    return r.changes > 0;
  }
  const r = await execute(`UPDATE qbo_connections SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                           WHERE company = ? AND version = ?`, [body, company, version]);
  return r.changes > 0;
}

async function deleteRecord(company) {
  if (isDemo()) return demoBucket().delete(r2Key(company));
  await execute('DELETE FROM qbo_connections WHERE company = ?', [company]);
}

// ---------- Intuit token endpoint ----------
async function tokenCall(url, body, cfg) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': url === QBO_REVOKE_URL ? 'application/json' : 'application/x-www-form-urlencoded',
    },
    body: url === QBO_REVOKE_URL ? JSON.stringify(body) : new URLSearchParams(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* revoke returns an empty body */ }
  if (!res.ok) {
    const err = new Error(json?.error_description || json?.error || `QuickBooks returned ${res.status}`);
    err.code = json?.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

function tokenFields(resp) {
  return {
    access_token_enc: encryptSecret(resp.access_token),
    refresh_token_enc: encryptSecret(resp.refresh_token),
    ...tokenTimes(resp),
  };
}

// Callback: code → tokens, stored for the company. One QuickBooks company per SB Ops company.
export async function completeConnection({ company, code, realmId, req, user }) {
  const cfg = qboConfig();
  if (!cfg) throw new Error('QuickBooks is not set up on this server');
  const existing = await loadRecord(company);
  if (existing?.data?.status === 'connected' && existing.data.realm_id !== realmId) {
    throw new Error('This company is already connected to a different QuickBooks company. Disconnect it first.');
  }
  const resp = await tokenCall(QBO_TOKEN_URL, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) }, cfg);
  const data = {
    company, realm_id: String(realmId), environment: cfg.environment, status: 'connected',
    ...tokenFields(resp),
    connected_by: user.username, connected_at: new Date().toISOString(), last_error: null,
    account_map: existing?.data?.realm_id === String(realmId) ? existing.data.account_map || {} : {},
  };
  await saveRecord(company, data, undefined);
  return data;
}

// Public view of the record: never tokens.
export async function connectionStatus(company) {
  const rec = await loadRecord(company);
  if (!rec) return { status: 'not_connected' };
  const d = rec.data;
  return {
    status: d.status, realm_id: d.realm_id, environment: d.environment,
    connected_by: d.connected_by, connected_at: d.connected_at,
    refresh_expires_at: d.refresh_expires_at, last_error: d.last_error,
    account_map: d.account_map || {},
  };
}

async function markDisconnected(company, rec, message) {
  const data = { ...rec.data, status: 'disconnected', last_error: message, access_token_enc: null, refresh_token_enc: null };
  await saveRecord(company, data, rec.version);
  try {
    const { notifyDepartmentHeads } = await import('./notify');
    await notifyDepartmentHeads('Accounts', {
      kind: 'quickbooks_disconnected', title: `QuickBooks disconnected for ${company}`,
      body: 'Reconnect it from Accounts → Company Entities.', link: '/accounts',
    });
  } catch { /* alert is best-effort */ }
}

// A valid access token for the company, refreshing it first when it is close to expiry.
// Intuit returns a new refresh token on refresh; it is saved in the same write.
export async function accessToken(company) {
  const cfg = qboConfig();
  if (!cfg) throw new Error('QuickBooks is not set up on this server');
  for (let attempt = 0; attempt < 3; attempt++) {
    const rec = await loadRecord(company);
    if (!rec || rec.data.status !== 'connected') throw new Error('QuickBooks is not connected for this company');
    if (!needsRefresh(rec.data)) return { token: decryptSecret(rec.data.access_token_enc), conn: rec.data };
    let resp;
    try {
      resp = await tokenCall(QBO_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: decryptSecret(rec.data.refresh_token_enc) }, cfg);
    } catch (err) {
      if (err.code === 'invalid_grant') {
        // Someone else may have refreshed with this token a moment ago; only give up if the record is unchanged.
        const now = await loadRecord(company);
        if (now && now.version !== rec.version) continue;
        await markDisconnected(company, rec, 'QuickBooks refused the saved sign-in (revoked or expired). Reconnect.');
        throw new Error('QuickBooks connection was revoked or expired. Reconnect it from Accounts.');
      }
      throw err;
    }
    const data = { ...rec.data, ...tokenFields(resp), last_error: null };
    if (await saveRecord(company, data, rec.version)) return { token: resp.access_token, conn: data };
  }
  throw new Error('Could not refresh the QuickBooks connection; try again');
}

// GET against the Accounting API for the connected company. 401 → one forced refresh and retry.
export async function qboGet(company, path, params = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { token, conn } = await accessToken(company);
    const q = new URLSearchParams({ ...params, minorversion: QBO_MINOR_VERSION });
    const res = await fetch(`${QBO_API_BASE[conn.environment]}/v3/company/${conn.realm_id}${path}?${q}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401 && attempt === 0) {
      const rec = await loadRecord(company);
      if (rec) await saveRecord(company, { ...rec.data, access_expires_at: null }, rec.version);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const fault = json?.Fault?.Error?.[0];
      throw new Error(fault ? `${fault.Message}${fault.Detail ? `: ${fault.Detail}` : ''}` : `QuickBooks returned ${res.status}`);
    }
    return json;
  }
  throw new Error('QuickBooks rejected the connection');
}

export async function saveAccountMap(company, rows) {
  const rec = await loadRecord(company);
  if (!rec || rec.data.status !== 'connected') throw new Error('QuickBooks is not connected for this company');
  const map = { ...(rec.data.account_map || {}) };
  for (const r of rows) { if (r.qbo_account_id) map[r.code] = r.qbo_account_id; else delete map[r.code]; }
  if (!(await saveRecord(company, { ...rec.data, account_map: map }, rec.version))) throw new Error('Someone else changed the connection; reload and try again');
  return map;
}

// Revoke at Intuit (best-effort: the user may already have disconnected from QuickBooks' side),
// then forget the record.
export async function disconnect(company) {
  const cfg = qboConfig();
  const rec = await loadRecord(company);
  if (!rec) return;
  if (cfg && rec.data.refresh_token_enc) {
    try { await tokenCall(QBO_REVOKE_URL, { token: decryptSecret(rec.data.refresh_token_enc) }, cfg); } catch { /* already revoked */ }
  }
  await deleteRecord(company);
}

// ---------- route helpers ----------
// Connect/disconnect/map: Accounts Head (or PM). In the public demo also only the owner-pass
// browser, so visitors can watch the live sandbox connection but never change it.
export async function manageDenied(user) {
  const { requireAction } = await import('./action-permissions');
  const denied = await requireAction(user, 'Accounts', 'accounts.quickbooks.connect');
  if (denied) return 'Only an Accounts Head can connect QuickBooks';
  if (isDemo()) {
    const [{ cookies }, { isOwnerPass }] = await Promise.all([import('next/headers'), import('./demo-leads.js')]);
    if (!isOwnerPass((await cookies()).get('demo_lead')?.value)) return 'Visitors can see the QuickBooks connection but not change it';
  }
  return null;
}

export async function companyById(id) {
  return queryOne('SELECT id, company FROM company_settings WHERE id = ?', [id]);
}
