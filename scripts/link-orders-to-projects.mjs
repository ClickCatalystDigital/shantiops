// scripts/link-orders-to-projects.mjs — one-off: link imported sale orders to the real projects
// they belong to (projects.sale_order_id), so Costing, the Sale Orders list and invoicing see them.
//   node scripts/link-orders-to-projects.mjs            # dry run, writes nothing
//   node scripts/link-orders-to-projects.mjs --apply    # link + write the manifest
//   node scripts/link-orders-to-projects.mjs --rollback # undo exactly what the manifest recorded
// A link is made only when all of these agree — anything else goes to the review CSV, never guessed:
//   * order number = project number (ignoring spaces/hyphens/leading zeros), or the project number
//     plus a letters-only site suffix when that is the only such order (SB-1109-15 ↔ SB-1109-15-ASIF);
//   * same company; customer agrees (same customer_id, or one cleaned name contains the other);
//   * the project has no sale order yet and the order isn't linked to another project.
import fs from 'fs';
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const MANIFEST = 'scripts/data/order-project-link-manifest.json';
const REVIEW = 'docs/order-project-link-review.csv';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const stmts = m.links.flatMap(l => [
    { sql: 'UPDATE projects SET sale_order_id = NULL WHERE id = ? AND sale_order_id = ?', args: [l.project_id, l.sale_order_id] },
    ...(l.set_customer_id ? [{ sql: 'UPDATE projects SET customer_id = NULL WHERE id = ? AND customer_id = ?', args: [l.project_id, l.set_customer_id] }] : []),
  ]);
  await db.batch(stmts, 'write');
  console.log(`Rolled back ${m.links.length} links.`);
  process.exit(0);
}

const tokens = s => String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).map(t => /^\d+$/.test(t) ? String(Number(t)) : t);
const key = s => tokens(s).join('|');
const STRIP = new Set(['PVT', 'P', 'LTD', 'LIMITED', 'PRIVATE', 'M', 'S', 'THE', 'CO', 'AND']);
const cname = s => String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w && !STRIP.has(w)).join('');
const sameCustomer = (p, o) => ((p.customer_id || p.inherited_customer_id) && o.customer_id) ? (p.customer_id || p.inherited_customer_id) === o.customer_id
  : !!(cname(p.customer_name) && cname(o.customer_name) && (cname(p.customer_name).includes(cname(o.customer_name)) || cname(o.customer_name).includes(cname(p.customer_name))));
const csv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

const projects = await q(`SELECT id, project_no, customer_name, customer_id, sale_order_id, company, master_project_id,
  (SELECT COUNT(*) FROM projects c WHERE c.master_project_id = p.id) kids FROM projects p WHERE COALESCE(is_system, 0) = 0 ORDER BY id`);
const orders = await q('SELECT id, so_no, customer_name, customer_id, company FROM sale_orders');
// a split unit usually has no customer_id of its own — it inherits the master's
const byId = new Map(projects.map(p => [p.id, p]));
for (const p of projects) if (!p.customer_id && p.master_project_id) p.inherited_customer_id = byId.get(p.master_project_id)?.customer_id || null;
const taken = new Set(projects.filter(p => p.sale_order_id).map(p => p.sale_order_id));
const byKey = new Map(orders.map(o => [key(o.so_no), o]));

const links = [], review = [];
for (const p of projects) {
  if (p.sale_order_id || p.kids) continue; // already linked; a split master's orders sit on its units
  const pt = tokens(p.project_no);
  let o = byKey.get(pt.join('|')), how = 'exact';
  if (!o) {
    const suff = orders.filter(x => { const t = tokens(x.so_no); return t.length > pt.length && pt.every((v, i) => t[i] === v) && t.slice(pt.length).every(v => /^[A-Z]+$/.test(v)); });
    if (suff.length === 1) { o = suff[0]; how = 'site suffix'; }
    else if (suff.length > 1) { review.push([p, suff.map(x => x.so_no).join(' / '), '', 'several orders with a site suffix']); continue; }
  }
  const near = orders.filter(x => x !== o && tokens(x.so_no).slice(0, pt.length).join('|') === pt.join('|'));
  if (!o) { if (near.length) review.push([p, near.map(x => x.so_no).join(' / '), near[0].customer_name, 'no exact order number; similar ones exist']); continue; }
  const why = taken.has(o.id) ? 'order already linked to another project'
    : o.company !== p.company ? `company differs (order: ${o.company})`
    : !sameCustomer(p, o) ? 'customer differs' : null;
  if (why) { review.push([p, o.so_no, o.customer_name, why]); continue; }
  taken.add(o.id);
  links.push({ project_id: p.id, project_no: p.project_no, sale_order_id: o.id, so_no: o.so_no, how,
    set_customer_id: !p.customer_id && o.customer_id ? o.customer_id : null });
  for (const x of near) if (!links.some(l => l.sale_order_id === x.id)) review.push([p, x.so_no, x.customer_name, `extra order for this project (linked to ${o.so_no}; a project holds one order)`]);
}

console.log(`Links: ${links.length}`);
for (const l of links) console.log(`  ${l.project_no.padEnd(16)} ← ${l.so_no.padEnd(20)} (${l.how}${l.set_customer_id ? `, customer_id ${l.set_customer_id}` : ''})`);
console.log(`Review: ${review.length}`);
for (const [p, so, c, why] of review) console.log(`  ${p.project_no.padEnd(16)} ${so.padEnd(22)} ${why}`);
fs.writeFileSync(REVIEW, ['project_no,project_customer,project_company,sale_order,order_customer,reason',
  ...review.map(([p, so, c, why]) => [p.project_no, p.customer_name, p.company, so, c, why].map(csv).join(','))].join('\n') + '\n');

if (!APPLY) { console.log('\nDRY RUN — nothing written (review CSV refreshed).'); process.exit(0); }
if (fs.existsSync(MANIFEST)) { console.error(`${MANIFEST} exists — roll back first.`); process.exit(1); }
await db.batch([
  ...links.flatMap(l => [
    { sql: 'UPDATE projects SET sale_order_id = ? WHERE id = ? AND sale_order_id IS NULL', args: [l.sale_order_id, l.project_id] },
    ...(l.set_customer_id ? [{ sql: 'UPDATE projects SET customer_id = ? WHERE id = ? AND customer_id IS NULL', args: [l.set_customer_id, l.project_id] }] : []),
  ]),
  { sql: 'INSERT INTO usb_audit (actor, action, detail) VALUES (?,?,?)', args: ['system:import', 'orders_linked_to_projects', `${links.length} projects linked to their sale orders`] },
], 'write');
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), links }, null, 1));
console.log(`Applied ${links.length} links; manifest ${MANIFEST}.`);
