// scripts/qc-reassign-certs.mjs — one-time backfill for the QC phase-2 model. Run against the shared
// Turso DB after the schema migration (certificate_projects + projects.series) has been applied by a
// server boot:
//   node --env-file=.env.local scripts/qc-reassign-certs.mjs
//
// It is idempotent (INSERT OR IGNORE / guarded UPDATE), so re-running is safe.
//   1. Populates certificate_projects from existing part→document→project citations. A cert cited by
//      two projects (a shared plate) simply gets two links — no row duplication, no deletes. Certs
//      cited by nothing stay unassigned (a valid state now).
//   2. Backfills projects.series (the equipment model) by reading it out of each project_no. The
//      model is a dash-segment matching a known code (e.g. STF-IBR-045-CF-400-15 → CF); old-format
//      numbers with no model segment (e.g. STF-IBR-022) are left null.
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = (sql, args = []) => db.execute({ sql, args });
const rows = async (sql, args = []) => (await q(sql, args)).rows;

const MODELS = ['CF', 'MF', 'OF', 'SF', 'SIB', 'PRS', 'FCB', 'FAB']; // mirrors lib/qc-series.js

console.log('BEFORE:', JSON.stringify((await rows('SELECT COUNT(*) certs, (SELECT COUNT(*) FROM certificate_projects) links FROM test_certificates'))[0]));

// 1) cert↔project links from citations
await q(`INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id)
         SELECT DISTINCT p.test_certificate_id, d.project_id
           FROM qc_document_parts p JOIN qc_documents d ON d.id = p.document_id
          WHERE p.test_certificate_id IS NOT NULL`);

// 2) project model backfill — parse it out of project_no's dash-segments
const projs = await rows('SELECT id, project_no FROM projects WHERE series IS NULL');
let matched = 0;
for (const p of projs) {
  const seg = String(p.project_no).split('-').map(s => s.toUpperCase()).find(s => MODELS.includes(s));
  if (seg) { await q('UPDATE projects SET series = ? WHERE id = ?', [seg, p.id]); matched++; }
}
console.log(`model backfill: matched ${matched} of ${projs.length} unset projects`);

console.log('AFTER links by project:', JSON.stringify(await rows(
  `SELECT p.project_no, p.series, COUNT(cp.certificate_id) certs
     FROM certificate_projects cp JOIN projects p ON p.id = cp.project_id GROUP BY cp.project_id`)));
console.log('unassigned certs:', (await rows('SELECT COUNT(*) n FROM test_certificates tc WHERE NOT EXISTS (SELECT 1 FROM certificate_projects cp WHERE cp.certificate_id = tc.id)'))[0].n);
console.log('docs finalized:', JSON.stringify(await rows(
  `SELECT d.project_id, COUNT(*) docs,
          SUM(CASE WHEN (SELECT COUNT(*) FROM qc_document_parts x WHERE x.document_id = d.id AND x.test_certificate_id IS NULL) = 0 THEN 1 ELSE 0 END) finalized
     FROM qc_documents d GROUP BY d.project_id`)));
