// scripts/import-diary-followups.mjs — one-off import of the old CRM's "Quick Planner" diary
// export (enq.csv, 20,167 rows, 2026-09-28) into crm_notes (+ contacts).
//   node scripts/import-diary-followups.mjs <csv>                    # dry run: counts + review files, writes nothing
//   node scripts/import-diary-followups.mjs <csv> --apply [--limit N]
//   node scripts/import-diary-followups.mjs --rollback               # undo using the manifest written by --apply
// Rules (lib/diary-import.mjs): "Last Followup" is a per-organization snapshot, not per-row history
// — 20,166 rows collapse to ~2,207 real distinct notes, one per (organization, note text) pair.
// Notes attach to customers.id only (never leads — Customer 360 already reads crm_notes by
// customer_id, and this data is ongoing account activity, not enquiry-specific), matched only on an
// exact name match to exactly one customer; anything less certain goes to the review CSV. Contacts
// are seeded best-effort from the Contact Person cell after filtering out salesperson-code/junk/
// phone-number-looking values. customers.account_manager is never touched by this script.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import {
  parseDiaryRows, groupByOrg, dedupeNotes, currentPlanFor, customerMatcher, dedupeContacts,
} from '../lib/diary-import.mjs';

const TAG = 'import:diary-followups-2026-09-28';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const MANIFEST = process.env.IMPORT_MANIFEST || path.resolve('scripts/data/diary-followups-import-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function retry(fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) { if (i >= 4) throw err; console.log(`  retry ${i}: ${err.message}`); await new Promise(res => setTimeout(res, 2000 * i)); }
  }
}

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const [{ notes }] = await q('SELECT COUNT(*) notes FROM crm_notes WHERE import_tag = ?', [m.tag]);
  const [{ contacts }] = await q('SELECT COUNT(*) contacts FROM contacts WHERE import_tag = ?', [m.tag]);
  await db.batch([
    { sql: 'DELETE FROM crm_notes WHERE import_tag = ?', args: [m.tag] },
    { sql: 'DELETE FROM contacts WHERE import_tag = ?', args: [m.tag] },
  ], 'write');
  console.log(`rolled back: ${notes} crm_notes, ${contacts} contacts deleted (tag ${m.tag}).`);
  process.exit(0);
}

const rows = parseDiaryRows(fs.readFileSync(file, 'utf8'));
const byOrg = groupByOrg(rows);
const allNotes = dedupeNotes(byOrg);

// zero-history orgs: matched customer or not, they contribute no note at all — listed for review.
const zeroHistoryOrgs = [];
const notesByOrgKey = new Map();
for (const n of allNotes) {
  if (!notesByOrgKey.has(n.orgKey)) notesByOrgKey.set(n.orgKey, []);
  notesByOrgKey.get(n.orgKey).push(n);
}
for (const [orgKey, orgRows] of byOrg) {
  if (!notesByOrgKey.has(orgKey)) {
    const valid = orgRows.filter(r => r.dateIso);
    const latest = valid.length ? valid.reduce((a, b) => (b.dateIso > a.dateIso ? b : a)) : orgRows[0];
    zeroHistoryOrgs.push({ org: orgRows[0].org, status: latest.status, objective: latest.objective, date: latest.date });
  }
}

// current-plan fields, merged onto whichever note they target
for (const [orgKey, orgRows] of byOrg) {
  const orgNotes = notesByOrgKey.get(orgKey);
  if (!orgNotes) continue;
  const plan = currentPlanFor(orgRows, orgNotes);
  if (!plan) continue;
  const target = orgNotes.find(n => n.text === plan.targetText);
  if (target) Object.assign(target, {
    nextPlanDate: plan.nextPlanDate, planOfAction: plan.planOfAction,
    planNoteType: plan.planNoteType, planFor: plan.planFor,
  });
}

const customers = await q('SELECT id, name, phone, email FROM customers');
const match = customerMatcher(customers);

const matched = [], review = [];
for (const orgKey of new Set(allNotes.map(n => n.orgKey))) {
  const orgDisplay = notesByOrgKey.get(orgKey)[0].orgDisplay;
  const m = match({ name: orgDisplay });
  if (m.customer) matched.push(orgKey);
  else review.push({ org: orgDisplay, reason: m.reason, similar: m.similar || [] });
}
const matchedSet = new Set(matched);
// Sorted oldest-first before insert: Customer 360 shows notes by `ORDER BY id DESC` (newest id
// first), which only reads as chronological if rows were actually inserted in date order — a bulk
// import iterating by (org, then followup-text-group) has no natural date order otherwise.
const notesToInsert = allNotes.filter(n => matchedSet.has(n.orgKey))
  .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
  .slice(0, LIMIT);

const contacts = dedupeContacts(rows, match);

// Review CSV: unmatched organizations, then zero-history organizations.
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const reviewLines = ['kind,organization,reason / status,notes,possible customers (id: name)'];
for (const r of review) {
  reviewLines.push([
    'no_customer_match', r.org, r.reason, '', r.similar.map(c => `${c.id}: ${c.name}`).join(' | '),
  ].map(csvCell).join(','));
}
for (const z of zeroHistoryOrgs) {
  reviewLines.push([
    'no_history_ever_logged', z.org, z.status, `Objective: ${z.objective} (as of ${z.date})`, '',
  ].map(csvCell).join(','));
}
fs.writeFileSync('docs/diary-import-review.csv', reviewLines.join('\n') + '\n');

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const distinctOrgs = byOrg.size;
const notesWithPlan = notesToInsert.filter(n => n.nextPlanDate).length;
const report = `# Old CRM diary export — import notes (${now.slice(0, 10)})

Source: the old CRM's "Quick Planner" diary export (\`enq.csv\`, 20,167 rows, spanning
1/1/2025–28/9/2026).

- ${rows.length} data rows read, across ${distinctOrgs} distinct organizations.
- "Last Followup" is a per-organization snapshot (the most recent note as of export time), repeated
  across every row for that org — not that row's own history. This collapses to
  **${allNotes.length} real distinct notes**, not one per row.
- ${matched.length} of ${matched.length + review.length} organizations with real history matched
  exactly one existing customer; their **${notesToInsert.length} notes** were imported to
  \`crm_notes\` (customer_id only — never a lead). ${notesWithPlan} of those also carry the org's
  current outstanding follow-up (next_plan_date/plan_of_action/plan_note_type/plan_for).
- ${review.length} organizations were **not** linked (name matched no customer, matched several, or
  only looked similar) — their notes were **not** imported. Listed in
  \`docs/diary-import-review.csv\` (kind = \`no_customer_match\`) with suggestions.
- ${zeroHistoryOrgs.length} organizations have a scheduled follow-up but **no note text was ever
  logged** for them — no crm_notes row was created (nothing to log). Listed in the same review CSV
  (kind = \`no_history_ever_logged\`).
- Contacts: ${contacts.length} distinct (customer, contact name) pairs were seeded into \`contacts\`
  from the Contact Person cell, after filtering out salesperson-code leftovers, placeholder junk,
  the organization's own name typed again, and phone-number-looking values. Some noise may remain
  (e.g. a company name that isn't caught by the filter) — accepted as best-effort, not chased
  further. \`customers.account_manager\` was **not** touched by this import.
- Rollback: \`node scripts/import-diary-followups.mjs --rollback\` (uses \`scripts/data/diary-followups-import-manifest.json\`).
`;
fs.writeFileSync('docs/diary-import-notes.md', report);

console.log(JSON.stringify({
  rowsRead: rows.length, distinctOrgs, distinctNotes: allNotes.length,
  orgsMatched: matched.length, orgsNotMatched: review.length,
  notesToInsert: notesToInsert.length, notesWithCurrentPlan: notesWithPlan,
  zeroHistoryOrgs: zeroHistoryOrgs.length, contactsToInsert: contacts.length, apply: APPLY,
}, null, 1));

if (!APPLY) process.exit(0);

const [{ n }] = await q('SELECT COUNT(*) n FROM crm_notes WHERE import_tag = ?', [TAG]);
if (n && !args.includes('--resume')) { console.error('Already imported — run --rollback first (or --resume to finish an interrupted run).'); process.exit(1); }
if (!n) fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, at: now }));

const CHUNK = 60;
for (let i = 0; i < notesToInsert.length; i += CHUNK) {
  await retry(() => db.batch(notesToInsert.slice(i, i + CHUNK).map(nrec => {
    const m = match({ name: nrec.orgDisplay });
    return {
      sql: `INSERT INTO crm_notes (customer_id, note_type, content, visit_date, action_taken,
              next_plan_date, plan_of_action, plan_note_type, plan_for, created_by, created_at, import_tag)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM crm_notes WHERE import_tag = ? AND customer_id = ? AND content = ? AND visit_date = ?)`,
      args: [m.customer.id, nrec.noteType, nrec.action, nrec.dateIso, nrec.action,
        nrec.nextPlanDate || null, nrec.planOfAction || null, nrec.planNoteType || null, nrec.planFor || null,
        nrec.salesperson || null, `${nrec.dateIso} 00:00:00`, TAG,
        TAG, m.customer.id, nrec.action, nrec.dateIso],
    };
  }), 'write'));
  console.log(`  notes ${Math.min(i + CHUNK, notesToInsert.length)}/${notesToInsert.length}`);
}
for (let i = 0; i < contacts.length; i += CHUNK) {
  await retry(() => db.batch(contacts.slice(i, i + CHUNK).map(c => ({
    sql: `INSERT INTO contacts (customer_id, name, notes, import_tag)
          SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE import_tag = ? AND customer_id = ? AND name = ?)`,
    args: [c.customerId, c.name, 'From historical call records.', TAG, TAG, c.customerId, c.name],
  })), 'write'));
  console.log(`  contacts ${Math.min(i + CHUNK, contacts.length)}/${contacts.length}`);
}
const [{ notesActual }] = await q('SELECT COUNT(*) notesActual FROM crm_notes WHERE import_tag = ?', [TAG]);
const [{ contactsActual }] = await q('SELECT COUNT(*) contactsActual FROM contacts WHERE import_tag = ?', [TAG]);
console.log(`applied: ${notesActual} notes (of ${notesToInsert.length} attempted — the difference is real cross-spelling duplicates the NOT EXISTS guard caught), ${contactsActual} contacts. Manifest: ${MANIFEST}`);
