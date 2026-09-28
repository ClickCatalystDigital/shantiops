# Old CRM diary export — import notes (2026-09-28)

Source: the old CRM's "Quick Planner" diary export (`enq.csv`, 20,167 rows, spanning
1/1/2025–28/9/2026).

- 20167 data rows read, across 2292 distinct organizations.
- "Last Followup" is a per-organization snapshot (the most recent note as of export time), repeated
  across every row for that org — not that row's own history. This collapses to
  **2199 real distinct notes**, not one per row.
- 1864 of 2078 organizations with real history matched
  exactly one existing customer; their **1940 notes** were imported to
  `crm_notes` (customer_id only — never a lead). 1068 of those also carry the org's
  current outstanding follow-up (next_plan_date/plan_of_action/plan_note_type/plan_for).
- 214 organizations were **not** linked (name matched no customer, matched several, or
  only looked similar) — their notes were **not** imported. Listed in
  `docs/diary-import-review.csv` (kind = `no_customer_match`) with suggestions.
- 214 organizations have a scheduled follow-up but **no note text was ever
  logged** for them — no crm_notes row was created (nothing to log). Listed in the same review CSV
  (kind = `no_history_ever_logged`).
- Contacts: 186 distinct (customer, contact name) pairs were seeded into `contacts`
  from the Contact Person cell, after filtering out salesperson-code leftovers, placeholder junk,
  the organization's own name typed again, and phone-number-looking values. Some noise may remain
  (e.g. a company name that isn't caught by the filter) — accepted as best-effort, not chased
  further. `customers.account_manager` was **not** touched by this import.
- Rollback: `node scripts/import-diary-followups.mjs --rollback` (uses `scripts/data/diary-followups-import-manifest.json`).
