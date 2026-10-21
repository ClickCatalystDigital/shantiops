// Nightly reset of the public SB Ops demo: delete the demo database and recreate it as a copy of the
// golden one (Turso "seed from database"), then move every date forward so the data looks current.
// The demo Worker uses a group token, which keeps working for the recreated database. Only ever touches
// DEMO_DB; never the leads database or anything else. Same shifter as savistar-ops/ls-inventory's copy.

const API = 'https://api.turso.tech/v1';

async function reset(env) {
  const base = `${API}/organizations/${env.TURSO_ORG}/databases`;
  const headers = { authorization: `Bearer ${env.TURSO_API_TOKEN}`, 'content-type': 'application/json' };
  const del = await fetch(`${base}/${env.DEMO_DB}`, { method: 'DELETE', headers });
  if (!del.ok && del.status !== 404) return { ok: false, step: 'delete', status: del.status, body: await del.text() };
  const create = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ name: env.DEMO_DB, group: env.GROUP, seed: { type: 'database', name: env.GOLDEN_DB } }),
  });
  if (!create.ok) return { ok: false, step: 'create', status: create.status, body: await create.text() };
  const { database } = await create.json();
  const tok = await fetch(`${base}/${env.DEMO_DB}/auth/tokens?expiration=15m`, { method: 'POST', headers });
  if (!tok.ok) return { ok: false, step: 'token', status: tok.status, body: await tok.text() };
  const { jwt } = await tok.json();
  try {
    return { ok: true, ...(await shiftDates(`https://${database.Hostname}`, jwt)) };
  } catch (e) {
    return { ok: false, step: 'shift', body: String(e) };
  }
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
  // The demo now reads as of today: say so, so scripts/demo-promote.sh in ahrom-labs can copy it to golden as is.
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
