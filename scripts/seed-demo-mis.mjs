// scripts/seed-demo-mis.mjs — demo AMC contracts for the Sales → AMC tab (SYSTEM.md §5dr).
// node --env-file=.env.local scripts/seed-demo-mis.mjs            dry run: shows what it would add
//      ... --apply                                                 adds 3 contracts (created_by = 'demo:mis'), with costs
//      ... --rollback                                              removes exactly those and puts the contract counter back
import { createClient } from '@libsql/client';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const TAG = 'demo:mis', MANIFEST = 'scripts/data/seed-demo-mis-manifest.json';
const apply = process.argv.includes('--apply'), rollback = process.argv.includes('--rollback');
const c = createClient({ url: process.env.TURSO_URL || process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const iso = d => d.toISOString().slice(0, 10);
const monthsAgo = n => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return iso(d); };
const monthsAhead = n => monthsAgo(-n);

if (rollback) {
  const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  await c.execute({ sql: 'DELETE FROM service_contract_costs WHERE contract_id IN (SELECT id FROM service_contracts WHERE created_by = ?)', args: [TAG] });
  const r = await c.execute({ sql: 'DELETE FROM service_contracts WHERE created_by = ?', args: [TAG] });
  if (m) await c.execute({ sql: "UPDATE counters SET value = ? WHERE name = 'service_contract_no'", args: [m.counterBefore] });
  console.log(`removed ${r.rowsAffected} demo contracts; counter restored to ${m?.counterBefore ?? '(unchanged — no manifest)'}`);
  process.exit(0);
}

const exists = (await c.execute({ sql: 'SELECT COUNT(*) n FROM service_contracts WHERE created_by = ?', args: [TAG] })).rows[0].n;
if (exists) { console.log(`already seeded (${exists} demo contracts) — run --rollback first`); process.exit(0); }
const projects = (await c.execute(`SELECT id, project_no, customer_name, customer_id FROM projects
   WHERE status = 'active' AND master_project_id IS NULL AND COALESCE(customer_name,'') <> '' AND COALESCE(is_system,0) = 0 AND project_no NOT LIKE 'ZZ%' ORDER BY id DESC LIMIT 3`)).rows;
const plan = [
  { freq: 'Quarterly', start: monthsAgo(3), end: monthsAhead(9), value: 180000, received: 90000, costs: [[monthsAgo(2), 'Service visit — travel', 6500], [monthsAgo(1), 'Spares — gaskets and rope', 12400]] },
  { freq: 'Half-yearly', start: monthsAgo(5), end: monthsAhead(7), value: 96000, received: 96000, costs: [[monthsAgo(3), 'Service visit — engineer', 9000]] },
  { freq: 'Monthly', start: monthsAgo(1), end: monthsAhead(11), value: 240000, received: 60000, costs: [] },
];
console.log(apply ? 'APPLY' : 'DRY RUN', '—', projects.length, 'projects found');
if (!apply) { projects.forEach((p, i) => plan[i] && console.log(` would add AMC for ${p.project_no} · ${p.customer_name}: ${plan[i].freq}, value ${plan[i].value}`)); process.exit(0); }
const before = (await c.execute("SELECT value FROM counters WHERE name = 'service_contract_no'")).rows[0]?.value ?? 1000;
mkdirSync('scripts/data', { recursive: true });
writeFileSync(MANIFEST, JSON.stringify({ counterBefore: before }));
let no = before;
for (let i = 0; i < projects.length && i < plan.length; i++) {
  const p = projects[i], x = plan[i]; no++;
  const r = await c.execute({ sql: `INSERT INTO service_contracts (contract_no, project_id, customer_id, customer_name, start_date, end_date, visit_frequency, entitlement, contract_value, received_value, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [no, p.id, p.customer_id, p.customer_name, x.start, x.end, x.freq, 'Scheduled preventive maintenance visits, breakdown support, wear-part replacement at cost', x.value, x.received, TAG] });
  for (const [d, desc, amt] of x.costs) await c.execute({ sql: 'INSERT INTO service_contract_costs (contract_id, cost_date, description, amount, created_by) VALUES (?, ?, ?, ?, ?)', args: [Number(r.lastInsertRowid), d, desc, amt, TAG] });
  console.log(` added SVC-${no} for ${p.project_no} · ${p.customer_name}`);
}
await c.execute({ sql: "UPDATE counters SET value = ? WHERE name = 'service_contract_no'", args: [no] });
