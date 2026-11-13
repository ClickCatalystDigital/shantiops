# Gulf Coast Exchanger: ASME QA/QC implementation plan (Phases 0, 1, 1b, 1c)

Date: 2026-11-12. Approved by the owner. US version only (`demo-us`). Nothing is built, migrated, deployed or committed.

## Context

Gulf Coast Exchanger (shell-and-tube heat exchangers, Texas) wants three things from the North American version: MTR-to-BOM traceability, a failed inspection that really stops downstream work, and a live Data Book. The audit (`docs/gulf-coast-asme-qaqc-audit.md`) found the platform can carry this but most of it is not built. Since the audit, the customer sent four files: three ITPs (Exchanger, Bundle Only, Parts Only) and their Data Book table of contents (Form 106 Rev 1). This plan uses them.

## Direct answers

**Can we build this with precise compliance?** Two different things:

| Kind | Answer |
|---|---|
| Their own procedure (ITP points, R/W/H types, Data Book Form 106 order, NCR loop) | Yes, exactly. We now have the documents. Every point, type and section is copied as data, and the server refuses out-of-order work. |
| Their acceptance limits (hardness, ferrite, "50 PPM chloride max") | Yes, once they confirm each number, unit and source. The app enforces what is configured; it does not know the limits by itself. |
| ASME / NBIC code rules (NDE acceptance, form content, retention, e-signature) | Not from us. We do not hold the licensed standards. Anything code-based is entered by their QC from their licensed copy and marked with its source. Items are flagged "Requires Licensed Standard Review" below. |
| Certification | Never. The app prepares records. The manufacturer, the Authorized Inspector and the National Board certify. Every PDF says "Prepared for review". |
| Official U-1 / U-5 / R-1 forms | Not in this scope (Phase 2). The Data Book has a slot where they upload the signed report. |

**Which department gets what (US version)?**

| Department | What they get |
|---|---|
| QC | ITP templates; the traveler with R/W/H points; inspection records with measured values and automatic pass/fail; acceptance rules; weld, WPS and welder registers with continuity status; NCR to repair to reinspection loop; batch MTR upload with review queue; heat trace; Data Book dashboard, preview and release |
| Production (Shop Floor) | The same traveler as their job card; a clear "blocked by" reason; Start/Finish refused while a required point is open or failed; a repair entry on an NCR |
| Engineering / Design | Section 1 review points (calculations, drawings, weld procedures); BOM lines linked to welds; approved drawings and calc reports flow into the Data Book |
| Stores | MTR linked to the receipt; receiving points (visual, tagging, PMI) on the traveler |
| Purchasing | MTR traced back to the PO line. Nothing else changes |
| Shipping (Dispatch) | Shipping is refused until the ITP is cleared and no NCR is open |
| Sales | Customer PO and item number shown on the ITP and Data Book headers. Nothing else |
| Management | Blocked jobs and open NCRs visible per project |
| Accounts, HR, Service | Nothing |
| Customer / third-party inspector | Not in this scope. QC records the customer's authorization for them. Their own login is Phase 3 |

**One company or all?** All. The module is generic: ITP templates, acceptance rules and Data Book templates are data, not code. Gulf Coast's three ITPs, their Form 106 and their limits are loaded by a seed script, like company details are today. Another fabricator gets their own templates. It lives only on the US branch; the India version is not touched.

## Audit error list (checked against the code)

| # | Audit said | Code / files show |
|---|---|---|
| 1 | ITP and Data Book ToC not yet provided | Both received. 3 ITPs, Form 106 |
| 2 | ~10 new tables for Phase 1 | 7 are enough. `job_sheets`, `qc_records`, `ncr_records` already hold most of it (see reuse table) |
| 3 | `ingest_jobs` + worker loop or Cloudflare Queue | Not needed. The browser sends one PDF per request to the existing extract call; rows survive a closed tab |
| 4 | Hold-point screens are orphaned (true) and nothing else uses the code | Ember AI action `qc_release_job_card` (`lib/assistant-actions.js:613`) calls the orphan route. Retiring it means removing that action, its Cue Card and its check case |
| 5 | Old gates return 409 | They return 400 (`job-cards/[id]/route.js:55`, `packing/[id]/route.js:83`). New gates return 409. Old ones are left alone |
| 6 | QC has no job card screen with sign-off | QC's "Job Cards" tab renders `JobSheetBoard` with QC sign, plus a "Job Card Stages" approval queue. They work; they just block nothing |
| 7 | `qc_records` has no attempt link | Also: `result` is freely editable (`qc-records/[id]/route.js:10`). A fail can be overwritten to pass. Must be frozen for linked records |
| 8 | MTR duplicates: unique cert+cast+plate | Enforced in the route (409), not by a database index |
| 9 | 26 commits ahead, risk "main moved" | 7 of the 26 are already on `main` (identical patches). 2 more Ember commits are on `main` in another form. 16 are US-only. Trial merge: 7 conflicted files, none in the US market layer |
| 10 | NCR rework is tied to old job cards | Confirmed, and verify + close also read `job_cards` (`ncrs/[id]/verify:26`, `close:25`) |
| 11 | Hydro test is a QC record | It is owned by Production, not QC (`qc-records/[id]/route.js:17`). ITP point 5.8 follows that |
| 12 | Hardness "200 ZBHN", ferrite 3 to 9 | Neither appears in the ITPs or Form 106. The only limit in the files is "50 PPM chloride max" on hydro water. All three stay customer questions |

Confirmed as the audit said: `asme_data` is written only by `scripts/demo/seed-acme-us.mjs:559`; `weldMapProblems()` is called only by its self-check; `job-sheets/.../[stageId]/route.js:4` says QC sign is "a record only"; MTR extraction is one PDF, never writes to the database.
Not re-checked (taken from the audit): `lib/bom-receiving.js:66`, calibration, Calc module, `certificate_projects` joins.

## What the customer's files tell us

- An ITP is a list of numbered points in 8 sections. Each point has a Gulf Coast document code (TRV traveler, DWG drawing, NDE, DCU other records) and a customer inspection type.
- R = review, production may proceed. W = witness, 48 hours' notice, production may proceed if the customer does not come. H = hold, "will not proceed without Customer authorization".
- Exchanger ITP: about 70 points. Bundle Only: no Section 4 or 6. Parts Only: short Section 5. Header: customer, PO, item, job number, Rev, date.
- Some points show "VT" or "V" in the customer column instead of R/W/H. Meaning unclear (question 3).
- The ITP has no "this point blocks that point" information. We propose the links; they confirm (question 1).
- Form 106 has 8 sections and about 27 lines, each with an "Included" tick. Several lines have no source in the app (nameplate facsimile, spec sheet, PWHT chart, paint, helium, tube expansion, PMI). Those are uploads.

## Design decisions

1. **The ITP is the job card.** Gulf Coast calls it the "Code QC Traveler". `job_sheets` + `job_sheet_stages` is already a typed card of ordered rows with production finish and QC sign. An ITP becomes a new card type whose rows are copied from a template. One table, one route, one screen. No `project_itp_steps`.
2. **An inspection attempt is a `qc_records` row.** A retest is a new row that points at the one it replaces. Linked rows are frozen once decided. No `inspection_attempts` table.
3. **Gate state is computed live, never stored** (same rule as `lib/dependency.mjs`). No status column to drift. Reopening a point re-blocks its dependents with no extra code.
4. **Prerequisites are a list on the row** (`requires` = point numbers such as `4.20,4.23`). A point may only require earlier points, so a cycle is impossible. `ponytail:` move to a join table if SQL ever needs the reverse lookup.
5. **One hold-point system.** The `job_cards` hold code is retired (details in Phase 1). The `job_cards` table and its other screens are not touched.
6. **`asme_data` stays for report header facts** (edition, stamp, inspector, shell, heads, nozzles). Welds, WPS, welders and NDE move to tables; the PDF gets the same shape built from them.
7. **Units:** a measurement must be in the rule's unit, or the save is refused. No conversions until the customer confirms scales. `ponytail:` add conversions per confirmed pair.
8. **No queue, no new service, no new dependency.** SHA-256 uses Web Crypto (Node and Workers). Bookmarks use `pdf-lib`, already installed.

### Reuse before adding

| Need | Existing table | Decision |
|---|---|---|
| ITP steps per job | `job_sheets`, `job_sheet_stages` | Reuse, add columns |
| ITP templates | `stage_templates` (keyed to department + milestone, label only) | Does not fit. New `itp_templates`, `itp_template_items` |
| Attempts | `qc_records` | Reuse, add columns |
| Measured values | none | New `qc_measurements` |
| Limits | `calc_validations` (design formulas) | Does not fit. New `acceptance_rules` |
| NCR, repair | `ncr_records` | Reuse, add columns |
| Welds, WPS, welders | JSON in `qc_documents.asme_data` | New `welds`, `wps`, `welders` |
| Hold release with history | `inward_approvals` pattern | Columns on the stage row; history in `usb_audit` |
| MTR review queue | none | New `mtr_intake` |
| File revisions | none | Not added. Old file kept in R2, old key + hash in `usb_audit`. `ponytail:` a revisions table when someone needs to browse them |
| Data Book | `bom_release_snapshots` (pattern), `qc_documents` | New `databook_templates`, `databooks`, `databook_files`, `databook_releases` |
| Route templates | `work_order_route_templates` | Not used (Work Orders are retired screens) |
| Instruments | `calibration_items` | Reuse as a picker on a measurement (optional `calibration_item_id`) |

Total new tables: 12 (7 + 1 + 4).

---

## Phase 0: dropped (owner decision, 2026-11-12)

All Gulf Coast work is for the US version only and is built on the `demo-us` branch (worktree `~/Developer/shanti-ops-us`). Nothing is merged into `main`, and the India version (demos, the live client) is not changed.

What this means for the rest of the plan:
- Every phase lands on `demo-us` and deploys with `npm run deploy:demo:us`. The India snapshot check is not needed.
- `demo-us` does not get `main`'s later work (QC-only client switch, customer portal changes, steel what-if). Bring a specific commit over by cherry-pick only when a phase needs it.
- New screens and tables need no India gating, since India never runs this branch.
- The deploy workflow job for the US demo was not added (it would run from `main`).

---

## Phase 1: traveler (ITP), inspections with values, welds, gates, NCR loop

### Migrations (all in `migrate()`, additive)

New tables:
```sql
CREATE TABLE IF NOT EXISTS itp_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, revision TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS itp_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES itp_templates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL, section TEXT NOT NULL, item_key TEXT NOT NULL, name TEXT NOT NULL,
  doc_code TEXT, point_type TEXT, requires TEXT, test_type TEXT,
  per_weld INTEGER NOT NULL DEFAULT 0, qc_only INTEGER NOT NULL DEFAULT 0, after_dispatch INTEGER NOT NULL DEFAULT 0,
  UNIQUE(template_id, item_key));
CREATE TABLE IF NOT EXISTS wps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wps_no TEXT NOT NULL UNIQUE, process TEXT NOT NULL, pqr_no TEXT,
  base_metal TEXT, thickness TEXT, pwht TEXT, is_repair INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', approved_by TEXT, approved_at DATETIME, pdf_key TEXT, pdf_sha256 TEXT,
  created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS welders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stamp TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id), wpq_no TEXT, wpq_pdf_key TEXT,
  processes_json TEXT, active INTEGER NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  -- processes_json = {"SMAW":{"qualified_on":"…","last_weld":"…"}}: the shape continuityRows() already reads
CREATE TABLE IF NOT EXISTS welds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id),
  weld_no TEXT NOT NULL, joint TEXT, category TEXT, type TEXT,
  wps_id INTEGER REFERENCES wps(id), welder_stamps TEXT, nde TEXT,
  part_a_bom_item_id INTEGER REFERENCES bom_items(id), part_b_bom_item_id INTEGER REFERENCES bom_items(id),
  welded_on TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, weld_no));
CREATE TABLE IF NOT EXISTS acceptance_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT NOT NULL, version INTEGER NOT NULL,
  characteristic TEXT NOT NULL, min REAL, max REAL,
  min_inclusive INTEGER NOT NULL DEFAULT 1, max_inclusive INTEGER NOT NULL DEFAULT 1, unit TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global', scope_value TEXT,   -- global | customer | project | material
  source TEXT NOT NULL, edition TEXT, effective_from TEXT, retired_at DATETIME,
  created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rule_key, version));
CREATE TABLE IF NOT EXISTS qc_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qc_record_id INTEGER NOT NULL REFERENCES qc_records(id) ON DELETE CASCADE,
  characteristic TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, location TEXT,
  rule_id INTEGER REFERENCES acceptance_rules(id), verdict TEXT,   -- pass | fail | null (no rule)
  calibration_item_id INTEGER REFERENCES calibration_items(id));
```

New columns (`addColumn`):
- `job_sheets`: `itp_template_id`, `itp_revision`, `customer_po`, `item_number`
- `job_sheet_stages`: `item_key`, `section`, `doc_code`, `point_type`, `requires`, `test_type`, `per_weld`, `qc_only`, `after_dispatch`, `notified_at`, `notified_by`, `released_at`, `released_by`, `release_ref`, `not_applicable`, `na_reason`
- `qc_records`: `job_sheet_stage_id`, `weld_id`, `supersedes_id`, `report_key`, `report_sha256`
- `ncr_records`: `job_sheet_stage_id`, `weld_id`, `repair_wps_id`, `repair_by`, `repair_at`, `repair_notes`

Every new table with a foreign key to `projects` or `bom_items` is added to `lib/project-delete.js` and `lib/bom-item-guard.js` (its self-check fails otherwise).

### Gate rules (pure, `lib/quality-gate.mjs`)

A point is **cleared** when it is marked N/A, or all of these hold:
- QC has signed it;
- if it is a Hold point: the customer's authorization is recorded (`released_at`);
- the latest inspection record for it (per weld and test type) is not a fail;
- no NCR linked to it is still open or dispositioned.

A point is **blocked** when any point in its `requires` list is not cleared. The result carries the reason ("4.20 Radiographs: RT failed on weld L1, NCR-1012 open").

Enforced in the write routes:

| Route | New refusal (409) |
|---|---|
| `PATCH /api/job-sheets/[id]/stages/[stageId]` `start`, `finish` | point is blocked |
| same, `qc` | point needs a test and has no passing latest record (every weld that lists the method, when `per_weld`); or an NCR on it is not closed |
| same, new `notify` (W) | none; stamps who and when. `start` on a W point is refused until notice is recorded |
| same, new `release` (H) | not QC-signed yet; or already released. One conditional `UPDATE … WHERE released_at IS NULL AND qc_sign_at IS NOT NULL`, rows-affected checked, so two parallel calls cannot both succeed |
| same, new `na` | reason missing |
| `PATCH /api/qc-records/[id]` | record is linked to a point and already pass/fail: result, type and values are frozen ("record a new inspection") |
| `DELETE /api/qc-records/[id]` | linked and decided |
| `POST /api/qc-records` | measurement fails a rule but `result: 'pass'` was sent; unit differs from the rule's unit (400) |
| `PATCH /api/packing/[id]` `status: 'dispatched'` | the project has an ITP card with any point not cleared (points flagged `after_dispatch` excepted), or any open NCR |

Cards without a template (India's boiler and APH cards) have none of these columns set, so none of the checks fire.

### Failure to release flow (core)

1. QC records RT on weld L1 with result fail (or a measured value outside its rule: the server sets fail). The row is frozen.
2. Point 4.20 is now not cleared. Every point that requires it (bundle insertion 5.5, hydro 5.8, final release 7.3) refuses Start with 409 and names 4.20.
3. The screen offers "Raise NCR", prefilled with point, weld and record. `POST /api/ncrs` gains `job_sheet_stage_id`, `weld_id` (checked to belong to the project).
4. QC Head dispositions (`qc.ncr.disposition`, existing). For a point-linked NCR no `job_cards` row is created. Repair or rework by welding needs `repair_wps_id`, and that WPS must be approved (409 otherwise). Scrap and use-as-is need notes (existing rule).
5. Production records the repair: `POST /api/ncrs/[id]/repair` (who, when, notes).
6. QC records a new RT on L1. `supersedes_id` is set to the failed row automatically. The failed row stays visible.
7. QC verifies (`qc.ncr.verify`): refused unless the repair is recorded and a passing record newer than the failed one exists for the same point, weld and test. Use-as-is verifies on notes alone.
8. QC closes the NCR (existing). QC signs the point; the customer's authorization is recorded if it is a Hold point.
9. 4.20 is cleared. Its dependents can start. Nothing was edited in place; the audit log has each step.

A second fail at step 6 keeps everything blocked and the loop repeats on the same NCR or a new one.

### Routes and permission keys

| Route | Purpose | Key (department) |
|---|---|---|
| `GET/POST /api/itp-templates`, `GET/PUT/DELETE /api/itp-templates/[id]` | templates and their points (whole-list save, `requires` must name earlier points) | `qc.itp.template` (QC) |
| `POST /api/job-sheets` (+ `itp_template_id`) | card from a template (rows copied) | `production.jobsheet.write` (existing) |
| `PATCH …/stages/[stageId]` `notify`, `na` | witness notice, not applicable | `qc.jobsheet.sign` (existing) |
| `PATCH …/stages/[stageId]` `release` | customer authorization on a Hold point | `qc.itp.release` (QC, seeded Head-only) |
| `POST /api/qc-records` (+ point, weld, measurements, report PDF) | inspection attempt | `qc.test.write` (existing; hydro stays Production) |
| `GET/POST /api/acceptance-rules`, `POST /api/acceptance-rules/[id]/revise`, `…/retire` | rules; limits are never updated, a change is a new version | `qc.rule.write` (QC, seeded Head-only) |
| `GET/POST /api/welds`, `PATCH/DELETE /api/welds/[id]` | weld register; saving a weld updates each welder's `last_weld`; response lists qualification problems | `qc.weld.write` (QC, Production) |
| `GET/POST /api/wps`, `PATCH /api/wps/[id]`, `POST /api/wps/[id]/approve` | WPS register | `qc.wps.write`; `qc.wps.approve` (seeded Head-only) |
| `GET/POST /api/welders`, `PATCH /api/welders/[id]` | welders and qualifications | `qc.welder.write` |
| `POST /api/ncrs/[id]/repair` | record the repair | `production.ncr.repair` (Production) |
| `PATCH /api/qc-documents/[id]` (+ `asme`) | report header facts, whitelisted by `cleanAsmeHeader()` in `lib/qc-asme.mjs` | `qc.document.write` (existing) |

### Files

- New: `lib/quality-gate.mjs`, `lib/acceptance.mjs` (pick rule by scope project > customer > material > global, evaluate with inclusive/exclusive bounds), `lib/quality.js` (database reads that feed the gate; `buildAsmeData(documentId)`), the routes above, `components/ItpTemplates.jsx`, `components/InspectionDialog.jsx`, `components/WeldRegister.jsx`, `components/AcceptanceRules.jsx`, `scripts/seed-itp-templates.mjs` (dry run / `--apply`), `scripts/data/gulf-coast-itp.json` (the three ITPs; untracked, customer data), `scripts/check-quality.mjs`.
- Changed: `lib/db.js`, `lib/action-permissions.js`, `server/api/job-sheets/route.js`, `server/api/job-sheets/[id]/stages/[stageId]/route.js`, `server/api/qc-records/route.js` and `[id]/route.js`, `server/api/ncrs/route.js`, `ncrs/[id]/disposition`, `verify`, `close`, `server/api/packing/[id]/route.js`, `server/api/qc-documents/[id]/route.js` and `pdf/route.js`, `lib/qc-asme.mjs`, `lib/qc-asme-pdf.js` (reads `buildAsmeData`), `components/JobSheetBoard.jsx`, `components/NcrPanel.jsx`, `components/QcWorkspace.jsx`, `components/QcDocumentEditor.jsx`, `lib/project-delete.js`, `lib/bom-item-guard.js`, `scripts/demo/seed-acme-us.mjs` (fills the tables instead of the JSON; a generic exchanger template for the demo), help guide, `lib/assistant-tabs.mjs` (regenerated).
- Retired (hold-point code on `job_cards`): `server/api/job-cards/[id]/qc-release/route.js`; the hold block in `server/api/job-cards/[id]/route.js`; the hold-linkage guard in `server/api/ncrs/route.js`; the `job_cards` branches in NCR disposition, verify and close; `requires_qc_hold` in `work-orders/[id]/generate-job-cards`; `components/QcHoldPanel.jsx`; Ember action `qc_release_job_card` with its Cue Card, check case and eval sentences; key `qc.hold.release`. Columns stay (no drops). A grep for `requires_qc_hold|qc-release|qc.hold.release` must return nothing but `lib/db.js`.

### Screens

- **QC → ITP Templates** (new tab): list; editor table with section, number, description, document code, point type, requires, test, per weld.
- **Job Card** (Shop Floor and QC, existing `JobSheetBoard`): "New card" offers the templates. A template card shows rows by section with R/W/H badge, state, and the blocking reason in red. Buttons by role: Start, Finish, Record inspection, QC sign, Notice sent (W), Customer release (H), N/A.
- **Inspection dialog:** test type, report number, weld, measurement rows (characteristic, value, unit, location, instrument) with the verdict shown as typed, report PDF. On fail: "Raise NCR".
- **QC → Welding** (new tab): weld register per project, WPS list, welders with continuity status (Current / Lapsed / No weld logged) from `continuityRows()`.
- **QC → Acceptance Rules** (new tab): rule, limits, unit, scope, source, version history.
- **NCR panel:** shows the point and weld; repair step; verify explains what is still missing.
- **QC document editor (US):** a "Data report details" section for the header facts.

### Checks

- `lib/quality-gate-selfcheck.mjs`: failed point blocks its dependents and not an unrelated section; second fail keeps the block; pass plus closed NCR clears only that chain; Hold without release is not cleared; N/A is cleared; reopen re-blocks; `requires` naming a later point is rejected.
- `lib/acceptance-selfcheck.mjs`: exactly at min and max, inclusive and exclusive; no rule gives no verdict; scope order; a new version does not change an old verdict; unit mismatch refused.
- `lib/qc-asme-selfcheck.mjs` (extended): tables produce the same shape the PDF read from JSON; `cleanAsmeHeader` drops unknown keys.
- `scripts/check-quality.mjs` (scratch SQLite, real routes, like `check-actions.mjs`): crafted Start on a blocked point gets 409; member without `qc.itp.release` gets 403; two parallel releases give one 200 and one 409; frozen record PATCH gets 409; the full fail → NCR → repair → retest → verify → close → release run; dispatch gets 409 with an open point and 200 after; a boiler card (no template) behaves exactly as before.
- Existing: `npm run check`, `scripts/check-actions.mjs`, US scan.

### Acceptance

- The Exchanger ITP is loaded as a template and a job gets all its points, in order, with the right types.
- Editing the template afterwards does not change that job's card.
- RT fail on L1 stops bundle insertion and hydro through the API, not only on screen.
- Every failed attempt is still listed after the pass.
- The ASME package PDF for a project prints welds, WPS, welders and NDE from the tables.
- US scan reports 0 hits.

Effort: 2.5 to 4 weeks.
Customer inputs: answers to questions 1 to 6 below.

---

## Phase 1b: batch MTR intake, duplicate check, heat trace

### Migrations
```sql
CREATE TABLE IF NOT EXISTS mtr_intake (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT NOT NULL, pdf_key TEXT, sha256 TEXT NOT NULL, size INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded | extracted | failed | duplicate | not_mtr | accepted | rejected
  doc_type TEXT, extracted_json TEXT, model TEXT, prompt_version TEXT, error TEXT,
  duplicate_of_id INTEGER REFERENCES mtr_intake(id),
  uploaded_by TEXT, uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_by TEXT, reviewed_at DATETIME);
CREATE INDEX IF NOT EXISTS idx_mtr_intake_sha ON mtr_intake(sha256);
```
Columns on `test_certificates`: `pdf_sha256`, `intake_id`, `stock_receipt_id`, `po_item_id` (all nullable).

### Routes (all `qc.certificate.write`, existing key)

| Route | Purpose |
|---|---|
| `POST /api/mtr-intake` | one PDF per request: check `%PDF` signature and size, hash, store in R2. Same hash as an earlier file: row saved as `duplicate`, nothing stored twice |
| `POST /api/mtr-intake/[id]/extract` | one model call (existing `extractFields`), new prompt returns `{doc_type, confidence, lines:[one per heat]}` with each strength value and its unit as printed. Raw output, model and prompt version are stored. A non-MTR is parked as `not_mtr` |
| `GET /api/mtr-intake` | queue |
| `POST /api/mtr-intake/[id]/accept` | reviewer's corrected lines become `test_certificates` rows in one transaction, sharing the PDF. 409 if cert + heat + plate already exists |
| `PATCH /api/mtr-intake/[id]` | reject / retry |
| `GET /api/trace?heat=` (also `?cert=`, `?project=`) | heat → certificates → receipt and PO line → pieces (with cut lineage) → BOM lines and projects → welds → QC document parts; and the reverse from a project |
| `GET /api/projects/[id]/trace-map/pdf` | Material Trace Map (Data Book section 5) |

The browser runs the batch: uploads files one by one, then calls extract with two at a time. Rows keep their state, so a closed tab resumes with "Continue". This fits the Workers per-request limits with no queue.

### Files
- New: `lib/mtr-extract.mjs` (prompt, `normalizeLines()`: trims, splits multi-heat, keeps unit text; pure), `lib/hash.js` (Web Crypto SHA-256), `lib/trace.js`, the routes, `components/MtrIntake.jsx`, `components/HeatTrace.jsx`, `lib/trace-map-pdf.js` (on `lib/report-pdf.js`).
- Changed: `lib/db.js`, `components/QcWorkspace.jsx` (Test Certificates group gains "Batch upload" and "Trace"), `server/api/test-certificates/route.js` and `[id]/route.js` (hash on single upload; replacing a PDF keeps the old object and writes old key + hash to the audit log), `components/CertForm.jsx` (reused per line in review), `lib/project-delete.js`.

### Screens
- **Batch upload:** drop zone; table of files with status; duplicates and non-MTRs marked.
- **Review:** PDF on the left (`PdfPreview`), one editable block per heat on the right, low-confidence fields highlighted, strength shown with the unit the mill printed. Accept or Reject. Nothing is saved without a reviewer.
- **Trace:** search by heat, certificate or project; chain shown top to bottom with links.

### Checks
- `lib/mtr-extract-selfcheck.mjs`: three heats give three lines; missing heat is refused; units kept as printed.
- `lib/hash` case inside it: same bytes, same hash.
- `scripts/check-quality.mjs` (extended): same file twice → second is `duplicate`; accept creates rows and links; accept of an existing cert key → 409; trace returns the full chain for a seeded heat, both directions.

### Acceptance
20 real MTR PDFs go in; each ends as accepted, rejected, duplicate or not-MTR; a chosen heat traces to a weld and a project and back.

Not in scope: checking chemistry or strength against the material specification (needs licensed spec limits; the rule table can hold them later). Scanned PDFs depend on the model reading images: tested on their worst scans before promising it.

Effort: 1 to 1.5 weeks.
Customer inputs: 10 to 20 real MTRs including bad scans (question 9).

---

## Phase 1c: Data Book (Form 106)

### Migrations
```sql
CREATE TABLE IF NOT EXISTS databook_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, form_no TEXT,
  lines_json TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS databooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
  template_name TEXT, lines_json TEXT NOT NULL, prepared_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  -- lines_json = [{key, section, label, source, state: 'required'|'na', note}]: copied from the template
CREATE TABLE IF NOT EXISTS databook_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), line_key TEXT NOT NULL,
  file_name TEXT NOT NULL, pdf_key TEXT NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT, uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS databook_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL,
  pdf_key TEXT NOT NULL, sha256 TEXT NOT NULL, pages INTEGER, manifest_json TEXT NOT NULL,
  released_by TEXT, released_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, revision));
```

### Where each Form 106 line comes from

| Section | Line | Source |
|---|---|---|
| | Cover page, 1 Table of Contents | generated (Form 106 layout with "Included" ticks and page numbers) |
| 2 | Customer Inspection and Shipping Release | generated from the ITP final release point + upload |
| 3 | Manufacturer's Data Reports | upload of the signed report (the app's own ASME package can be added as "prepared for review") |
| 3 | Nameplate or stamping facsimile | upload |
| 4 | Exchanger specification sheet | upload |
| 4 | Calculations | Calc report PDF (existing) or upload |
| 4 | Drawing details "as built" | approved drawing files (existing) |
| 4 | Welding procedures (WPS) | WPS PDFs used by the project's welds |
| 4 | Weld map | generated weld register + uploaded drawing |
| 4 | Welder stencil map | generated (weld × welder stamp) |
| 4 | Welder performance qualification records | welder WPQ PDFs for the stamps used |
| 5 | Bill of Material | BOM PDF (existing `lib/bom-pdf.js`) |
| 5 | Material Test Reports | certificate PDFs linked to the project |
| 5 | Material Trace Map | generated (Phase 1b) |
| 6 A–K | Pressure, MT, PT, RT, UT, VT, dimensional, PMI, hardness, helium, tube expansion | summary page from inspection records of that type + their attached report PDFs; or upload; or N/A |
| 7 A, B | PWHT chart, coating / paint reports | upload |
| 8 | Miscellaneous | uploads, free labels |

### Routes

| Route | Purpose | Key |
|---|---|---|
| `GET/POST /api/databook-templates`, `PUT /api/databook-templates/[id]` | templates | `qc.databook.template` |
| `GET /api/projects/[id]/databook` | lines with live completeness (included / missing / N/A, counts) | internal read |
| `PUT /api/projects/[id]/databook` | create from a template; mark a line N/A with a note | `qc.databook.write` |
| `POST/DELETE /api/projects/[id]/databook/files` | uploads per line (hashed) | `qc.databook.write` |
| `GET /api/projects/[id]/databook/pdf` | preliminary PDF, built live, "PRELIMINARY" on every page | internal read |
| `POST /api/projects/[id]/databook/release` | 409 if a required line is missing, an ITP point is not cleared or an NCR is open. Stores the merged PDF and a manifest (every file key, hash, record ids) | `qc.databook.release` (seeded Head-only) |
| `GET /api/databook-releases/[id]/pdf` | the stored file, never rebuilt | internal read |

### Files
- New: `lib/databook.mjs` (pure: `completeness(lines, facts)`, manifest builder), `lib/databook.js` (collects facts and files), `lib/databook-pdf.js` (cover + ToC with `@react-pdf/renderer`; merge, continuous "Page x of y" stamp and bookmarks with `pdf-lib`; two passes for ToC page numbers, like `computeRanges` in `lib/qc-folder-pdf.js`), routes, `components/DataBook.jsx`, `scripts/data/gulf-coast-databook.json` + loader in `scripts/seed-itp-templates.mjs`.
- Changed: `lib/db.js`, `lib/action-permissions.js`, `components/QcWorkspace.jsx` (Data Book tab), project page QC section (status line + link), `lib/project-delete.js`, demo seed.

### Screens
- **QC → Data Book:** project picker; Form 106 as a table: line, source, state (green included, red missing, grey N/A), files, Upload, N/A. Header counts. Buttons: Preview, Release (Head). Released revisions listed with download.

### Checks
- `lib/databook-selfcheck.mjs`: missing required line is listed; N/A needs a note; manifest is stable for the same inputs.
- `scripts/check-quality.mjs` (extended): release with a missing line → 409; release → file stored; a change after release leaves the released file's hash the same; a second release is revision 2.
- PDF checked by rendering: bookmarks match sections, pages numbered continuously, ToC page numbers correct.

### Acceptance
The dashboard follows the records live; the preliminary PDF is in Form 106 order with a ToC, bookmarks and page numbers; the released file never changes.

Effort: 1 to 1.5 weeks.
Customer inputs: one finished (redacted) Data Book to compare against (question 8).

---

## Effort summary

| Phase | Range |
|---|---|
| 0 Merge | dropped |
| 1 Traveler, inspections, welds, gates, NCR | 2.5 to 4 weeks |
| 1b MTR intake and trace | 1 to 1.5 weeks |
| 1c Data Book | 1 to 1.5 weeks |
| Total | 4.5 to 7 weeks, one engineer, customer answers arriving on time |

The audit said 4 to 6 weeks; the screens (five new tabs) are the difference.

## Not in this plan

U-1 / U-5 / R-1 forms, signatures, inspector or customer login, overrides with justification, material-spec checks on MTRs, substitutions, retention policy, malware scanning, on-premises install. These are the audit's Phases 2 and 3.

## End-to-end verification (after all phases, on scratch SQLite, `MARKET=NA`)

1. `npm run check`
2. `TURSO_URL=file:<scratchpad>/q.db TURSO_AUTH_TOKEN= node scripts/demo/seed-acme-us.mjs`, then `node scripts/check-quality.mjs`
3. In the browser on the same scratch database: upload MTRs → review → trace a heat to weld L1 → record RT fail → try Start on bundle insertion (refused) → NCR → repair → retest pass → verify → close → release → Data Book goes green → Preview → Release.
4. `node scripts/demo/us-scan.mjs` on the same scratch database: 0 hits.

## Questions for Gulf Coast (still open)

1. Which points must be complete before which? We will send our proposed links for the Exchanger ITP (for example RT 4.20 and shell inspection 4.24 before bundle insertion 5.5; 5.7 before hydro 5.8; everything before final release 7.3) for them to mark up.
2. Hold points: who gives the authorization and how (email, signed ITP, inspector on site)? What should we store as proof?
3. Some points show "VT" or "V" in the customer column. Is that a fourth type or a typing slip?
4. Witness points: is recording that notice was sent enough, or must the app wait until the agreed time has passed?
5. Hardness: is "200" Brinell (HBW)? Weld, HAZ or both? Instrument? Source specification?
6. Ferrite 3 to 9: Ferrite Number or percent? Method? Source?
7. "50 PPM chloride max" on hydro water: recorded per test with a lab report?
8. One finished, redacted Data Book and one filled ITP.
9. 10 to 20 typical MTRs, including the worst scans.
10. Code editions, jurisdiction, stamps held (U, R, NB), and their inspection agency.
11. Should an unqualified or lapsed welder on a weld stop the weld record, or only raise a warning?

## Questions for the owner

1. Agree that the ITP is a job card type (one traveler), not a separate ITP module?
2. Agree to retire the old `job_cards` hold code including the Ember action "release a held job card"?
3. May Gulf Coast's ITP and Form 106 JSON live in the repo (`scripts/data/`, untracked like other customer data), or only in their deployment's seed?
4. Build on the US demo first with Acme-named templates, or wait for a Gulf Coast deployment?
