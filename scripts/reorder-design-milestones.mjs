// One-off: re-order the Design milestones on EXISTING projects to
//   design -> release_drawings -> design_approval -> release_bom -> procurement_enquiry
// (new projects get this from MILESTONE_TEMPLATE). Dry run by default; --apply writes.
// Only rows still on the old default sort_order are moved; a manually customised row is left alone.
//   node --env-file=.env.local scripts/reorder-design-milestones.mjs [--apply]
import { createClient } from '@libsql/client';
import fs from 'node:fs';
const apply = process.argv.includes('--apply');
const c = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const OLD = { design: 0, design_approval: 1, release_bom: 2, release_drawings: 3 };
const NEW = { design: 0, release_drawings: 1, design_approval: 2, release_bom: 3 };
const DEPS = { release_drawings: 'design', design_approval: 'release_drawings', release_bom: 'design_approval' };
const keys = Object.keys(OLD).map(k => `'${k}'`).join(',');
const rows = (await c.execute(`SELECT id, project_id, milestone_key, sort_order, depends_on_key FROM milestones WHERE milestone_key IN (${keys})`)).rows;
const enq = (await c.execute(`SELECT id, depends_on_key FROM milestones WHERE milestone_key = 'procurement_enquiry' AND depends_on_key = 'release_drawings'`)).rows;
const stmts = [];
for (const r of rows) {
  if (Number(r.sort_order) === OLD[r.milestone_key] && NEW[r.milestone_key] !== OLD[r.milestone_key])
    stmts.push({ sql: 'UPDATE milestones SET sort_order = ? WHERE id = ?', args: [NEW[r.milestone_key], r.id] });
  if (DEPS[r.milestone_key] && r.depends_on_key !== DEPS[r.milestone_key])
    stmts.push({ sql: 'UPDATE milestones SET depends_on_key = ? WHERE id = ?', args: [DEPS[r.milestone_key], r.id] });
}
for (const r of enq) stmts.push({ sql: "UPDATE milestones SET depends_on_key = 'release_bom' WHERE id = ?", args: [r.id] });
console.log(`${rows.length} design rows, ${enq.length} procurement_enquiry rows, ${stmts.length} updates ${apply ? '(applying)' : '(dry run)'}`);
if (apply && stmts.length) {
  fs.writeFileSync(`scripts/data/reorder-design-milestones-backup-${Date.now()}.json`, JSON.stringify({ rows, enq }));
  await c.batch(stmts, 'write');
  await c.execute({ sql: "INSERT INTO usb_audit (actor, action, detail) VALUES ('script:reorder-design-milestones', 'milestones_reordered', ?)", args: [`${stmts.length} updates`] });
  console.log('done');
}
