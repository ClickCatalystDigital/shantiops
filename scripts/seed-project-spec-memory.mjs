// scripts/seed-project-spec-memory.mjs — teaches the New Project defaults from projects that already exist:
// for each project made from a Sale Order, the series/design/capacity/pressure it has are recorded against
// the order's main product (lib/order-spec.mjs). Split children are skipped (they copy their master).
//   node --env-file=.env.local scripts/seed-project-spec-memory.mjs [--apply | --rollback]
import { createClient } from '@libsql/client';
import { mainLine, SPEC_FIELDS } from '../lib/order-spec.mjs';
import { isValidSeries } from '../lib/qc-series.js';

const APPLY = process.argv.includes('--apply'), ROLLBACK = process.argv.includes('--rollback');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const SEED = 'seed'; // saved_at marker is not available; seeded rows are recorded in the manifest below

if (ROLLBACK) {
  const rows = (await q("SELECT value FROM app_settings WHERE key = 'project_spec_memory_seeded'"))[0];
  const ids = rows ? JSON.parse(rows.value) : [];
  for (const id of ids) await db.execute({ sql: 'DELETE FROM project_spec_memory WHERE project_id = ?', args: [id] });
  await db.execute("DELETE FROM app_settings WHERE key = 'project_spec_memory_seeded'");
  console.log(`rolled back ${ids.length} projects`); process.exit(0);
}

const projects = await q(`SELECT id, project_no, sale_order_id, series, model_design, model_capacity, model_pressure FROM projects
  WHERE sale_order_id IS NOT NULL AND master_project_id IS NULL`);
const plan = [], skipped = { noLines: 0, noMain: 0, noProduct: 0 };
for (const p of projects) {
  const lines = await q(`SELECT i.product_id, i.item_description, i.qty, i.rate, i.amount, sp.product_name, sp.product_type
    FROM sale_order_items i LEFT JOIN sales_products sp ON sp.id = i.product_id WHERE i.sale_order_id = ? ORDER BY i.sort_order, i.id`, [p.sale_order_id]);
  if (!lines.length) { skipped.noLines++; continue; }
  const main = mainLine(lines);
  if (!main) { skipped.noMain++; continue; }
  if (!main.line.product_id) { skipped.noProduct++; continue; }
  for (const f of SPEC_FIELDS) {
    const v = p[f], ok = f === 'series' ? isValidSeries(v) : f === 'model_design' ? !!v : Number(v) > 0;
    if (ok) plan.push({ project_id: p.id, product_id: main.line.product_id, field: f, value: String(v), project_no: p.project_no });
  }
}
console.log(JSON.stringify({ projectsWithOrder: projects.length, skipped, rows: plan.length, byField: Object.fromEntries(SPEC_FIELDS.map(f => [f, plan.filter(r => r.field === f).length])),
  sample: plan.slice(0, 6).map(r => `${r.project_no} ${r.field}=${r.value} (product ${r.product_id})`) }, null, 1));
if (!APPLY) { console.log('Dry run — pass --apply.'); process.exit(0); }
for (const r of plan) await db.execute({ sql: `INSERT INTO project_spec_memory (project_id, product_id, field, value) VALUES (?, ?, ?, ?)
  ON CONFLICT(project_id, field) DO NOTHING`, args: [r.project_id, r.product_id, r.field, r.value] });
await db.execute({ sql: "INSERT INTO app_settings (key, value) VALUES ('project_spec_memory_seeded', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [JSON.stringify([...new Set(plan.map(r => r.project_id))])] });
console.log('applied', plan.length, 'rows');
