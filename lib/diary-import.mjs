// lib/diary-import.mjs — pure parsing/dedup for the old CRM's "Quick Planner" diary export
// (enq.csv, 20,167 rows, 2026-09-28). Used by scripts/import-diary-followups.mjs. No DB import.
//
// Two real data-quality facts drive this file, both confirmed against the actual export before
// writing any of this (see the approved plan for the full evidence trail):
//
// 1. A "back-anchored" row shift. 154 of 20,167 rows have a mangled multi-line Location/Contact
//    block that pushes every later column right by 1 or 2 positions — naive column-name reading
//    loses the true Status value off the end. S.N./Date/IN Time/Organization are always
//    front-anchored (never shifted); Objective/Task Type/Entry For/Created By/Status are always the
//    last 5 real values in the row regardless of shift amount. Reading from both ends recovers
//    every row with zero data loss.
//
// 2. "Last Followup" ("Date DD/MM/YYYY, Action Taken <text>") is a live-computed "most recent note
//    on this account" snapshot, repeated identically across every one of that organization's rows —
//    not that specific row's own history. 20,166 rows collapse to only ~2,207 real distinct notes.
//    Everything else is the planner's own reminder queue (the same note, restated on every
//    reschedule) and is not imported as a separate note.
import { parseCsv, clean } from './legacy-crm-import.mjs';
import { isoDate } from './enquiry-import.mjs';
import { customerKey, customerMatchReasons } from './customer-match.mjs';

// "28/09/2026" -> "2026-09-28"; anything else -> null. Same shape as enquiry-import's isoDate.
const toIso = v => isoDate(v);

// Task Type -> the app's real, DB-enforced enum (app/api/crm-notes/route.js: NOTE_TYPES minus
// 'feedback' for plan_note_type). Phone/E-mail/Appointment map to their real channel; everything
// else (SMS, Offer Submission, Others, Support, Courier — none of which has its own crm_notes
// concept) falls to the generic 'note'.
const TASK_TYPE_MAP = { Phone: 'call', 'E-mail': 'email', Appointment: 'meeting' };
export const mapNoteType = taskType => TASK_TYPE_MAP[clean(taskType)] || 'note';

const FOLLOWUP_RE = /^Date\s+(\d{2}\/\d{2}\/\d{4}),\s*Action Taken\s*([\s\S]*)$/;

// One raw CSV row -> the recovered record. `middle` is whatever's left between Organization and
// the back-anchored tail — width 3 on a normal row (Location, Contact Person, Contact), wider on a
// shifted one (the mangled block); only width-3 rows have a usable Contact Person for lib.
function parseRow(cells, line) {
  const row = [...cells];
  while (row.length && row[row.length - 1] === '') row.pop();
  if (row.length < 10) return null; // not a real data row
  const n = row.length;
  const middle = row.slice(4, n - 6);
  return {
    line,
    sn: clean(row[0]),
    date: clean(row[1]),
    dateIso: toIso(row[1]),
    org: clean(row[3]),
    orgKey: clean(row[3]).toLowerCase(),
    contactPerson: middle.length === 3 ? clean(middle[1]) : '',
    lastFollowup: clean(row[n - 6]),
    objective: clean(row[n - 5]),
    taskType: clean(row[n - 4]),
    entryFor: clean(row[n - 3]),
    createdBy: clean(row[n - 2]),
    status: clean(row[n - 1]),
  };
}

export function parseDiaryRows(text) {
  const rows = parseCsv(String(text).replace(/^﻿/, ''));
  const [, ...body] = rows; // drop header
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const r = parseRow(body[i], i + 2);
    if (r && r.org && r.dateIso) out.push(r);
  }
  return out;
}

export function groupByOrg(rows) {
  const byOrg = new Map();
  for (const r of rows) {
    if (!byOrg.has(r.orgKey)) byOrg.set(r.orgKey, []);
    byOrg.get(r.orgKey).push(r);
  }
  return byOrg;
}

// Distinct (org, Last-Followup-text) pairs across the whole file = the real historical notes.
// Representative fields (Task Type / salesperson) come from whichever row sharing this exact text
// has a date closest to the note's own embedded date — the best available proxy for "who actually
// logged it, and how".
export function dedupeNotes(byOrg) {
  const notes = [];
  for (const [orgKey, rows] of byOrg) {
    const orgDisplay = rows[0].org;
    const groups = new Map(); // lastFollowup text -> rows[]
    for (const r of rows) {
      if (!r.lastFollowup) continue;
      if (!groups.has(r.lastFollowup)) groups.set(r.lastFollowup, []);
      groups.get(r.lastFollowup).push(r);
    }
    for (const [text, members] of groups) {
      const m = FOLLOWUP_RE.exec(text);
      if (!m) continue; // none observed in the real file, but never assumed
      const dateIso = toIso(m[1]);
      const action = clean(m[2]);
      if (!dateIso || !action) continue;
      const rep = members.reduce((best, r) => {
        if (!r.dateIso) return best;
        const d = Math.abs(new Date(r.dateIso) - new Date(dateIso));
        return d < best.d ? { row: r, d } : best;
      }, { row: members[0], d: Infinity }).row;
      notes.push({
        orgKey, orgDisplay, text, dateIso, action,
        noteType: mapNoteType(rep.taskType),
        salesperson: rep.entryFor || rep.createdBy || null,
      });
    }
  }
  return notes;
}

// The org's current outstanding plan, if any: the max-Date row across the whole export. Pending ->
// there's a real next follow-up due; Completed -> nothing outstanding. The max-Date row's own
// Last Followup is usually one of this org's dedupeNotes() entries (so the plan fields land on a
// note that's already being created); on the rare row (6 orgs, confirmed) where that specific row's
// Last Followup is blank despite the org having other history, fall back to the org's
// latest-by-embedded-date note instead — still a real note, just not literally the max-Date row's own.
export function currentPlanFor(rows, orgNotes) {
  const valid = rows.filter(r => r.dateIso);
  if (!valid.length) return null;
  const latest = valid.reduce((a, b) => (b.dateIso > a.dateIso ? b : a));
  if (latest.status !== 'Pending') return null;
  let targetText = latest.lastFollowup;
  if (!targetText && orgNotes.length) {
    targetText = orgNotes.reduce((a, b) => (b.dateIso > a.dateIso ? b : a)).text;
  }
  if (!targetText) return null;
  return {
    targetText,
    nextPlanDate: latest.dateIso,
    planOfAction: latest.objective || null,
    planNoteType: mapNoteType(latest.taskType),
    planFor: latest.entryFor || latest.createdBy || null,
  };
}

// --- Customer matching (reuses lib/enquiry-import.mjs's own matcher — same exact-name-to-one-
// customer rule the earlier enquiry import already used) -----------------------------------------
export { customerMatcher } from './enquiry-import.mjs';

// --- Contact Person filter (Sales CRM diary import, decision: create, best-effort) ---------------
// Raw values are very noisy: salesperson-code leftovers ("bdm", "SD2", "Srivaari"), placeholder
// junk ("aa", "cc", "zzz"), the organization's own name typed again, and bare phone numbers. None
// of these are a real contact's name; a short blocklist plus a couple of shape checks (verified
// against the real file's own top values before being written) clears almost all of it. Some noise
// (a company name that doesn't match any blocklist entry) will still get through — accepted, not
// chased further.
const SALES_SUBSTR = ['sales desk', 'bdm', 'srivaari', 'sd2', 'sd1', 'amit b', 'sales1', 'sales2', 'offer submission'];
const JUNK_TOKENS = new Set(['na', 'n/a', '-', 'mr', 'mrs', 'sir', 'md', 'dr', 'aa', 'aaa', 'cc', 'ccc', 'ss', 'zzz',
  'call', 'follow up', 'followup', 'offer', 'test', 'xx', 'xxx', 'yy', 'nil', 'none', '.']);
const LEGAL_WORDS = new Set(['pvt', 'ltd', 'limited', 'private', 'llp', 'the', 'and']);
const compactName = s => clean(s).toLowerCase().split(/[\s.,()&-]+/).filter(w => w && !LEGAL_WORDS.has(w)).join('');

export function isUsableContactName(contactPerson, org) {
  const v = clean(contactPerson);
  if (!v) return false;
  const lower = v.toLowerCase();
  if (v.length < 3) return false;
  if (JUNK_TOKENS.has(lower)) return false;
  if (SALES_SUBSTR.some(s => lower.includes(s))) return false;
  if (/^[a-z]{1,4}$/.test(lower)) return false; // bare initials/short codes (TC, SCM, md, …)
  if (compactName(v) === compactName(org)) return false; // the org's own name, typed again
  const digitCount = (v.match(/\d/g) || []).length;
  if (digitCount >= 5) return false; // phone-number-looking
  return true;
}

// Distinct (customerId, contactName) pairs, matched-customer rows only. `match` is the function
// returned by customerMatcher(customers).
export function dedupeContacts(rows, match) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!isUsableContactName(r.contactPerson, r.org)) continue;
    const m = match({ name: r.org });
    if (!m.customer) continue;
    const key = `${m.customer.id}|${clean(r.contactPerson).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ customerId: m.customer.id, name: clean(r.contactPerson) });
  }
  return out;
}

export { customerKey, customerMatchReasons };
