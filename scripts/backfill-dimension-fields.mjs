// Fills bom_items.category_fields_json (structured length/width/thickness, section size ...) from the size text, for
// dimensional lines that only have the text (PMB imports). Uses the same reader the edit form pre-fills from
// (fieldsFromSizeSpec). Never touches size_spec, never overwrites existing structured fields, skips text it cannot read
// unambiguously (bundled sizes, "as per drawing" ...). Dry-run by default.
//   node --env-file=.env.local scripts/backfill-dimension-fields.mjs [--apply] [--skip SB-1040]
import { createClient } from '@libsql/client';
import { fieldsFromSizeSpec } from '../lib/section-shapes.js';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skip = new Set(args.includes('--skip') ? args[args.indexOf('--skip') + 1].split(',') : []);
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const CATS = ['plate', 'flat', 'round', 'square', 'angle', 'beam', 'channel'];
const rows = (await db.execute(`SELECT b.id, p.project_no, b.category, b.size_spec, b.material_description d FROM bom_items b JOIN projects p ON p.id=b.project_id
  WHERE p.status='active' AND p.master_project_id IS NULL AND b.source='bom' AND b.category IN (${CATS.map(c => `'${c}'`).join(',')})
  AND (b.category_fields_json IS NULL OR b.category_fields_json='') AND b.size_spec IS NOT NULL`)).rows.map(r => ({ ...r }));
const todo = [], unread = {};
for (const r of rows) {
  if (skip.has(r.project_no)) continue;
  const f = fieldsFromSizeSpec(r.category, r.size_spec);
  if (Object.keys(f).length) todo.push({ ...r, f });
  else (unread[r.project_no] = unread[r.project_no] || []).push(r);
}
const by = {}; for (const t of todo) by[t.category] = (by[t.category] || 0) + 1;
console.log(apply ? 'filling' : 'would fill', todo.length, 'lines', by);
console.log('cannot read (stay text-only):', Object.fromEntries(Object.entries(unread).map(([k, v]) => [k, v.length])));
if (!args.includes('--quiet')) for (const t of todo.filter((_, i) => i % Math.ceil(todo.length / 14 || 1) === 0)) console.log(' ', t.project_no, t.category, '|', String(t.size_spec).replace(/\s+/g, ' ').slice(0, 44), '->', JSON.stringify(t.f));
if (apply) {
  for (const t of todo) await db.execute({ sql: 'UPDATE bom_items SET category_fields_json = ? WHERE id = ? AND (category_fields_json IS NULL OR category_fields_json = \'\')', args: [JSON.stringify(t.f), t.id] });
  await db.execute({ sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:dimension-backfill', 'bom_dimension_backfill', ?)", args: [JSON.stringify({ lines: todo.length, by })] });
}
