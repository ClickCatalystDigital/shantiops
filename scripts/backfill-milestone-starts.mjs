// One-time catch-up for the 2026-10-03 milestone rules (SYSTEM.md §5dz), on projects that already
// passed the trigger before the rule existed. Starts only (never completes, never reopens), no
// notifications:
//   - X done and its NEXT_ON_DONE successor untouched -> successor in_progress (release_bom -> Enquiry,
//     each Procurement rung -> next, site_installation -> commissioning)
//   - at least one done service visit -> site_installation in_progress
//   - any job-card stage started -> marking_cutting in_progress
// Dry run by default: node --env-file=.env.local scripts/backfill-milestone-starts.mjs [--apply]
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const APPLY = process.argv.includes('--apply');
const NEXT_ON_DONE = { release_bom: 'procurement_enquiry', procurement_enquiry: 'procurement_comparison', procurement_comparison: 'procurement_ordered',
  procurement_ordered: 'procurement_transit', procurement_transit: 'procurement_procured', site_installation: 'commissioning' };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const plan = []; // { id, project_no, key, why, start }
const untouched = `m2.status = 'pending' AND m2.actual_start IS NULL AND m2.actual_end IS NULL`;
for (const [done, next] of Object.entries(NEXT_ON_DONE)) {
  for (const r of await q(`SELECT m2.id, p.project_no, COALESCE(m1.actual_end, ?) AS start FROM milestones m1
      JOIN milestones m2 ON m2.project_id = m1.project_id AND m2.milestone_key = ? JOIN projects p ON p.id = m1.project_id
     WHERE m1.milestone_key = ? AND (m1.status = 'done' OR m1.actual_end IS NOT NULL) AND ${untouched} AND p.is_system = 0`, [today, next, done]))
    plan.push({ ...r, key: next, why: `${done} done` });
}
for (const r of await q(`SELECT m2.id, p.project_no, MIN(v.visit_date) AS start FROM milestones m2 JOIN projects p ON p.id = m2.project_id
    JOIN installation_visits v ON v.project_id = p.id AND v.status = 'done'
   WHERE m2.milestone_key = 'site_installation' AND ${untouched} GROUP BY m2.id`))
  plan.push({ ...r, start: r.start || today, key: 'site_installation', why: 'service visit done' });
for (const r of await q(`SELECT m2.id, p.project_no, MIN(s.start_date) AS start FROM milestones m2 JOIN projects p ON p.id = m2.project_id
    JOIN job_sheets js ON js.project_id = p.id JOIN job_sheet_stages s ON s.sheet_id = js.id AND s.start_date IS NOT NULL
   WHERE m2.milestone_key = 'marking_cutting' AND ${untouched} GROUP BY m2.id`))
  plan.push({ ...r, start: r.start || today, key: 'marking_cutting', why: 'job card stage started' });

const seen = new Set();
const unique = plan.filter(p => !seen.has(p.id) && seen.add(p.id));
for (const p of unique) console.log(`${p.project_no.padEnd(16)} ${p.key.padEnd(24)} start ${p.start}  (${p.why})`);
console.log(`${unique.length} milestone(s) to start${APPLY ? '' : ' — dry run, pass --apply'}`);
if (APPLY && unique.length) {
  await db.batch(unique.flatMap(p => [
    { sql: `UPDATE milestones SET status = 'in_progress', actual_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND actual_start IS NULL`, args: [p.start, p.id] },
    { sql: `INSERT INTO usb_audit (actor, action, detail) VALUES ('script:milestone-starts-2026-10-03', 'milestone_backfill_start', ?)`, args: [`${p.project_no} ${p.key} (${p.why})`] },
  ]), 'write');
  console.log('applied');
}
