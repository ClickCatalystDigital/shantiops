// lib/lead-sync.js — pulls leads from IndiaMART and TradeIndia (Marketing → Lead sources). No
// scheduled job (decided 2026-10-03): maybeSweepLeadSources() rides on the bell's existing poll, so
// leads are collected while anyone has SB Ops open (at most once per 5 min overall, each source at its
// own pace); "Sync now" pulls on demand. Leads that arrive overnight are picked up next time — IndiaMART
// keeps a year and one request covers up to 7 days, so nothing is lost. Push sources (JustDial,
// website) don't need this; they call /api/lead-hooks/<token>.
import { execute, queryAll, getAppSetting, setAppSetting } from './db';
import { decryptSecret } from './crypto';
import { LEAD_SOURCES, MAPPERS, indiamartTime, pullWindow } from './lead-sources.mjs';
import { ingestLeads } from './lead-ingest';

const istDate = d => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Unexpected reply (HTTP ${res.status}): ${text.slice(0, 160)}`); }
}

// Returns raw provider rows, or throws with the provider's own message.
async function pullRaw(source, creds, win) {
  if (source === 'indiamart') {
    const q = new URLSearchParams({ glusr_crm_key: creds.crm_key, start_time: indiamartTime(win.from), end_time: indiamartTime(win.to) });
    const j = await fetchJson(`https://mapi.indiamart.com/wservce/crm/crmListing/v2/?${q}`);
    if (Number(j.CODE) === 200) return j.RESPONSE || [];
    if (Number(j.CODE) === 204) return []; // "no leads in the given time duration"
    throw new Error(`IndiaMART ${j.CODE}: ${j.MESSAGE || j.STATUS || 'error'}`);
  }
  if (source === 'tradeindia') {
    const q = new URLSearchParams({ userid: creds.userid, profile_id: creds.profile_id, key: creds.key, from_date: istDate(win.from), to_date: istDate(win.to) });
    const j = await fetchJson(`https://www.tradeindia.com/utils/my_inquiry.html?${q}`);
    if (Array.isArray(j)) return j;
    if (j && (j.error || j.message)) throw new Error(`TradeIndia: ${j.error || j.message}`);
    return [];
  }
  throw new Error(`${source} is not a pull source`);
}

// One source account: pull, save, record the outcome on the account row. Never throws.
export async function syncAccount(account) {
  const meta = LEAD_SOURCES[account.source];
  await execute('UPDATE lead_source_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?', [account.id]);
  try {
    if (!account.credentials_enc) throw new Error('Not connected — enter the credentials first');
    const creds = JSON.parse(decryptSecret(account.credentials_enc));
    const win = pullWindow(account.last_success_at ? `${account.last_success_at.replace(' ', 'T')}Z` : null);
    const raw = await pullRaw(account.source, creds, win);
    const result = await ingestLeads(account, raw.map(MAPPERS[account.source]));
    await execute(
      `UPDATE lead_source_accounts SET last_success_at = CURRENT_TIMESTAMP, last_error = NULL, last_added = ?, total_added = total_added + ? WHERE id = ?`,
      [result.added + result.merged, result.added + result.merged, account.id]);
    return { ok: true, label: meta.label, ...result };
  } catch (err) {
    await execute('UPDATE lead_source_accounts SET last_error = ? WHERE id = ?', [String(err.message).slice(0, 300), account.id]);
    return { ok: false, label: meta?.label, error: err.message };
  }
}

// Pull every connected source that is due. Called (not awaited) from the bell poll.
export async function maybeSweepLeadSources() {
  try {
    const last = await getAppSetting('lead_sources_last_sweep');
    if (last && Date.now() - Date.parse(last) < 5 * 60e3) return;
    await setAppSetting('lead_sources_last_sweep', new Date().toISOString()); // claim before the slow part
    const accounts = await queryAll(
      "SELECT * FROM lead_source_accounts WHERE enabled = 1 AND credentials_enc IS NOT NULL AND source IN ('indiamart','tradeindia')");
    for (const a of accounts) {
      const every = (LEAD_SOURCES[a.source].everyMin || 5) * 60e3;
      if (a.last_sync_at && Date.now() - Date.parse(`${a.last_sync_at.replace(' ', 'T')}Z`) < every) continue;
      await syncAccount(a);
    }
  } catch (err) {
    console.error('lead sources sweep', err);
  }
}
