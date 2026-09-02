import fs from 'node:fs';
import { createClient } from '@libsql/client';

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
async function q(sql, args = []) { return (await client.execute({ sql, args })).rows; }

const PID = 50; // SB-1040

console.log('=== project ===');
console.log(await q('SELECT id, project_no, customer_name, status, bom_release_revision FROM projects WHERE id=?', [PID]));

console.log('\n=== release_bom milestone ===');
console.log(await q("SELECT id, milestone_key, status, actual_start, actual_end FROM milestones WHERE project_id=? AND milestone_key='release_bom'", [PID]));

console.log('\n=== bom_items count / with assembly_id ===');
console.log(await q('SELECT COUNT(*) n FROM bom_items WHERE project_id=?', [PID]));
console.log(await q('SELECT COUNT(*) n FROM bom_items WHERE project_id=? AND assembly_id IS NOT NULL', [PID]));

console.log('\n=== bom_assemblies for this project ===');
console.log(await q('SELECT * FROM bom_assemblies WHERE project_id=?', [PID]));

console.log('\n=== calc_drawings for this project (any to reuse instead of creating new) ===');
console.log(await q('SELECT id, dg_no, name, status FROM calc_drawings WHERE project_id=?', [PID]));

console.log('\n=== calc_sheets for this project ===');
console.log(await q('SELECT id, cs_no, name FROM calc_sheets WHERE project_id=?', [PID]));

console.log('\n=== bom_change_notes (ECN) for this project ===');
console.log(await q('SELECT id, bom_item_id, field_changed, status FROM bom_change_notes WHERE project_id=?', [PID]));

console.log('\n=== a few sample unassigned bom_items to use in the test ===');
console.log(await q('SELECT id, material_description, section FROM bom_items WHERE project_id=? ORDER BY id LIMIT 5', [PID]));

client.close();
