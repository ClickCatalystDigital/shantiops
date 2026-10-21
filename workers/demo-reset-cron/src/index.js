// Nightly reset of the public SB Ops demo (boiler-erp.ahromlabs.com). The owner pass works on the golden database directly (the app's
// GOLDEN_TURSO_URL), so golden holds the owner's data. Each night: back golden up to <golden>-prev, move golden's dates
// up to today, then delete the demo database and recreate it as a copy of golden (Turso "seed from database"), which
// wipes every other visitor's changes. If the date shift fails, golden is put back from the backup.
// The demo Worker uses a group token, which keeps working for recreated databases. Only ever touches DEMO_DB, GOLDEN_DB
// and the backup; never the leads database or anything else.

const API = 'https://api.turso.tech/v1';

async function reset(env) {
  const base = `${API}/organizations/${env.TURSO_ORG}/databases`;
  const headers = { authorization: `Bearer ${env.TURSO_API_TOKEN}`, 'content-type': 'application/json' };
  // Delete `name` (if there) and recreate it as a copy of `from`.
  const copy = async (name, from) => {
    const del = await fetch(`${base}/${name}`, { method: 'DELETE', headers });
    if (!del.ok && del.status !== 404) throw new Error(`delete ${name}: ${del.status} ${await del.text()}`);
    const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name, group: env.GROUP, seed: { type: 'database', name: from } }) });
    if (!res.ok) throw new Error(`create ${name}: ${res.status} ${await res.text()}`);
  };
  const backup = `${env.GOLDEN_DB}-prev`;
  try { await copy(backup, env.GOLDEN_DB); } catch (e) { return { ok: false, step: 'backup', error: e.message }; }
  let shifted, shiftError;
  try {
    const db = await fetch(`${base}/${env.GOLDEN_DB}`, { headers });
    if (!db.ok) throw new Error(`golden: ${db.status} ${await db.text()}`);
    const { database } = await db.json();
    const tok = await fetch(`${base}/${env.GOLDEN_DB}/auth/tokens?expiration=1h&authorization=full-access`, { method: 'POST', headers });
    if (!tok.ok) throw new Error(`token: ${tok.status} ${await tok.text()}`);
    const { jwt } = await tok.json();
    shifted = await shiftDates(`https://${database.Hostname}`, jwt);
  } catch (e) {
    shiftError = e.message;
    try { await copy(env.GOLDEN_DB, backup); } catch (r) { return { ok: false, step: 'restore golden', error: `${shiftError}; ${r.message}` }; }
  }
  try { await copy(env.DEMO_DB, env.GOLDEN_DB); } catch (e) { return { ok: false, step: 'demo', error: e.message, shiftError }; }
  return shiftError ? { ok: false, step: 'shift (golden restored, demo reset)', error: shiftError } : { ok: true, ...shifted };
}

// libsql HTTP pipeline. A just-created database can take a few seconds to accept queries, so retry.
async function run(url, token, sqls) {
  const body = JSON.stringify({ requests: [...sqls.map(sql => ({ type: 'execute', stmt: { sql } })), { type: 'close' }] });
  for (let i = 0; ; i++) {
    const res = await fetch(`${url}/v2/pipeline`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
    if (res.ok) {
      const { results } = await res.json();
      const err = results.find(r => r.type === 'error');
      if (err) throw new Error(err.error.message);
      return results.slice(0, sqls.length).map(r => r.response.result);
    }
    if (i >= 5) throw new Error(`pipeline ${res.status}: ${await res.text()}`);
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}

const DAY = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'";
const MONTH = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]'";

// Shift every ISO date (and 'YYYY-MM' period) in every table by today − demo_meta.seeded_on, keeping any time part.
// Only values that are real dates: a financial year such as '2026-27' matches the month pattern but is left alone.
// Two passes (+100 years, then back) so UNIQUE(…, date) columns never collide mid-update.
// ponytail: dates inside free text / JSON and FY-coded numbers don't move; fine for a nightly demo.
// today is the IST date: the cron runs at 21:30 UTC, when the UTC date is still the day before.
export async function shiftDates(url, token, today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10)) {
  const [meta] = await run(url, token, [`SELECT seeded_on FROM demo_meta LIMIT 1`]);
  const seededOn = meta.rows[0]?.[0]?.value;
  const n = Math.round((Date.parse(today) - Date.parse(seededOn)) / 864e5);
  if (!seededOn || !n) return { shifted: 0 };
  const [cols] = await run(url, token, [
    `SELECT m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_%' ESCAPE '\\' AND m.name <> 'demo_meta'`,
  ]);
  const stmts = days => cols.rows.flatMap(([t, c]) => {
    const [tq, cq] = [`"${t.value}"`, `"${c.value}"`];
    return [
      `UPDATE ${tq} SET ${cq} = date(substr(${cq},1,10),'${days} days') || substr(${cq},11) WHERE typeof(${cq}) = 'text' AND ${cq} GLOB ${DAY} AND date(substr(${cq},1,10)) IS NOT NULL`,
      `UPDATE ${tq} SET ${cq} = substr(date(${cq} || '-15','${days} days'),1,7) WHERE typeof(${cq}) = 'text' AND ${cq} GLOB ${MONTH} AND date(${cq} || '-15') IS NOT NULL`,
    ];
  });
  for (const days of [n + 36525, -36525]) {
    const all = stmts(days >= 0 ? `+${days}` : `${days}`);
    // ~300 tables × their columns: big batches keep the run under the Worker's 50-subrequest limit.
    for (let i = 0; i < all.length; i += 1500) await run(url, token, all.slice(i, i + 1500));
  }
  // Golden now reads as of today: record it, so tomorrow's shift moves it by one day.
  await run(url, token, [`UPDATE demo_meta SET seeded_on = '${today}'`]);
  return { shifted: n, columns: cols.rows.length };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reset(env).then(r => { if (!r.ok) console.error('demo reset failed', JSON.stringify(r)); }));
  },
  // Manual run (testing): POST with x-trigger-key.
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!env.TRIGGER_KEY || req.headers.get('x-trigger-key') !== env.TRIGGER_KEY) return new Response('Unauthorized', { status: 401 });
    const r = await reset(env);
    return Response.json(r, { status: r.ok ? 200 : 502 });
  },
};
