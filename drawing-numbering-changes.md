# Real drawing (DG-) and calc-sheet (CS-) numbers

Companion doc to `entity-tagging-changes.md` (same "decision log kept as historical record"
precedent as `PROCUREMENT-CHANGES.md`/`STORES-SALES-CHANGES.md`/`operations-tab-changes.md`).
Written mid-build so a fresh chat can pick this up without re-deriving context. Resolves
`entity-tagging-changes.md`'s Deferred §1.

## What this is

Reverses the 2026-08-19 decision (`lib/db.js`, then at what's now around line 1983) that
deliberately rejected a stored `drawing_no` column as a "duplicate concept" of `calc_drawings.name`.
Drawings now get a real, permanent, minted `dg_no` (`DG-####`); calc sheets — which never had any
code at all — get the same treatment (`cs_no`, `CS-####`). Both are wired through every
infrastructure surface an existing minted ID uses in this app (mint, schema, backfill, display,
reports, entity-ref tagging), verified against SYSTEM.md's documented ID conventions, not just the
code. Doing that surfaced a second finding: QC's statutory-form "Drawing No." fields had no link at
all to `calc_drawings` — closing that link (making `DG-` canonical inside QC) is part of this round
too.

## Status: fully shipped and browser-verified, including the QC half

Everything, including the QC canonical-drawing-number work, was verified live in a follow-up
session (see "Verified live" below) — one real bug was found and fixed in the process
(`SearchableSelect` was already imported once in `QcDocumentEditor.jsx`; the new import created a
duplicate-binding webpack build error, caught immediately on first page load).

### Decisions locked (in order asked)

1. **`DG-`/`CS-` are synthetic global counters** (`nextNumber`), same idiom as `jc_no`/`wo_no` — a
   drawing/calc-sheet register number is the app-invented tracking-number kind (confirmed against
   SYSTEM.md: `po_no`'s FY-format and `project_no`'s structured code are the *other* family, real/
   business-format numbers — a drawing register number isn't that).
2. **`DWG-` (the old derived, unstored entity-ref token) is retired entirely**, replaced by `DG-`.
   No dual-token period; a bare `DWG-1` in old free text now degrades to plain text.
3. **Both fully taggable** — `@`-mention + clickable link + tooltip, same wiring as every other
   entity.
4. **`DG-` is canonical inside QC**:
   - `qc_iiia_groups` (Form III A groups): new `calc_drawing_id` FK + a picker; printed
     `drawing_no` becomes the linked drawing's `dg_no`.
   - `qc_documents`' folder-level "Drawing No's" line (and every other place a QC statutory PDF
     prints a drawing number — Form XVII, Form III, the single-part TC page): **derived**, not
     typed or separately linked — `qc_documents.project_id` and `calc_drawings.project_id` already
     share the project, and "one model per folder" (SYSTEM.md, client-confirmed 2026-08-16) means
     one document per project in the normal case. Every `status = 'approved'` drawing on that
     project, **fully computed and read-only** — Design owns drawing approval, QC gets no override
     point at the document level.
   - Format: a **comma-separated list of codes** (`DG-1002, DG-1015`), not a from/to range — `DG-`
     is a *global* counter, not per-project, so a min/max range would falsely imply a contiguous
     run through other projects' drawings on a statutory document.
   - The old `qc_documents.drawing_no`/`drawing_no_from`/`drawing_no_to` fields **were** editable,
     required inputs on both the creation and edit sheets (driven off the shared
     `QC_HEADER_FIELDS` registry in `lib/qc-document-fields.js`) — an earlier pass in this same
     session wrongly concluded they had no UI at all (only grepped the editor component directly,
     missed the shared field-registry file a separate `QcHeaderField.jsx` renders off). Corrected:
     removed from `QC_HEADER_FIELDS` (cascades — both sheets stop showing/requiring them, both API
     routes stop accepting/requiring them, since `EDITABLE`/`REQUIRED_KEYS`/`HEADER_FIELDS` all
     derive from that one array), replaced with a read-only derived display in
     `BoilerDetailsSheet`.

## Mint / schema / backfill

- `nextNumber('drawing_no', 'DG')` in `addDrawing` (`lib/calc.js`), `nextNumber('calc_sheet_no',
  'CS')` in `createCalcSheet` (`lib/calc.js`) — same primitive every other minted ID uses
  (`lib/db.js`'s `nextNumber`/`nextCounterValue`, atomic `ON CONFLICT ... RETURNING` upsert, no
  pre-seeding needed).
- `addColumn(client, 'calc_drawings', 'dg_no TEXT')`, `addColumn(client, 'calc_sheets', 'cs_no
  TEXT')`, `addColumn(client, 'qc_iiia_groups', 'calc_drawing_id INTEGER REFERENCES
  calc_drawings(id)')` — all in `lib/db.js`'s `migrate()`.
- Two new backfills, exact same shape as the existing `backfillJobCardCode` template (marker guard
  → select blank → id-padded `UPDATE` → partial unique index → insert marker):
  `backfillDrawingCode` (marker `calc_drawings_dg_no_v1`), `backfillCalcSheetCode` (marker
  `calc_sheets_cs_no_v1`). Registered in `migrate()` alongside the others. **Verified live** against
  the real remote Turso DB — first request after this change (`POST /api/login`, ~22s, one-time
  migration cost) ran both backfills clean with no errors; confirmed existing rows now show
  `DG-000030`/`CS-000010`-style codes (6-digit, id-padded — the same "old rows padded, new rows
  counter-format, never collide as strings" guarantee `jc_no` already relies on).
- `qc_iiia_groups.calc_drawing_id` gets **no backfill** — nullable, no automatic name→id matching
  attempted (ambiguous mapping); a human links it via the new picker.

## Display surfaces

`dg_no`/`cs_no` now show (backfilled-format verified live; new-mint format `DG-1001` verified live
by creating a real drawing on SB-1040):

- Drawing: DrawingCard header (`CalcWorkspace.jsx`), Design panel list (`DesignPanel.jsx`),
  customer portal row (`PortalOrderProgress.jsx`), Drawing Register report (screen + Excel export),
  and the two spots that used to **fake** a `DWG-{padded id}` — `BomTable.jsx`'s linked-drawing
  subtitle and `PrWorkspace.jsx`'s PR drawing picker — now show the real `dg_no`.
- Calc sheet: project sheet-selector cards, workspace sidebar label + switcher, Design panel
  calc-sheet list.

## Entity-ref registry (`lib/entity-refs.js` + `lib/entity-ref-tokens.js`)

- Token grammar: `DWG` dropped, `DG`/`CS` added.
- `resolveDrawing` repointed to query `WHERE dg_no = ?` (was `idFrom(id)`); label is now the code
  itself (was the drawing's `name`) — `name` moved into the tooltip's `meta`, matching how
  `JC-`/`WO-`/`NCR-` already work.
- `resolveCalcSheet` (net new) — the one entity type here with a real per-record URL, so its `href`
  is the exact sheet workspace link (`/calc/project/{project_id}/{id}`), not the usual
  project-page fallback.
- `REFS`/`ENTITY_TYPES`/`searchEntityRefs` updated to match (`DG`/`CS` in, `DWG` out; "Calc Sheet"
  added to the `@`-picker's type-chip list).

## QC wiring (implemented and browser-verified)

- `lib/data.js`'s `getQcDocumentDetail`: `qc_iiia_groups` query now joins `calc_drawings` for
  `linked_drawing_dg_no`; `document.approved_drawing_codes` is a new computed array (every approved
  drawing's `dg_no` on that document's project).
- `lib/qc-folder-pdf.js`: every place that used to print `drawing_no_from`/`drawing_no_to`/
  `drawing_no` (the folder manifest line, Form XVII, Form III, the single-part TC page) now prints
  `approved_drawing_codes.join(', ')`; Form III A group pages print `linked_drawing_dg_no ||
  drawing_no` (fallback for groups nobody has linked yet).
- `app/api/qc-documents/[id]/iiia-groups/[groupId]/route.js`: `calc_drawing_id` added to the PATCH
  allowlist.
- `components/QcDocumentEditor.jsx`: `IiiaGroupCard` gets a real drawing picker (`SearchableSelect`
  over the project's `calc_drawings`, same idiom `PrWorkspace.jsx`'s drawing picker already uses)
  replacing the old free-text `drawing_no` input; `BoilerDetailsSheet` gets a read-only "Drawing
  No's" display sourced from `document.approved_drawing_codes`.
- **New permission surface**: `/api/calc-drawings` GET was Design/Engineering-gated only
  (`requireCalcAccess`); QC's new picker needs to *read* a project's drawing list. Added
  `requireCalcReadAccess` (`lib/calc.js`) — Design/Engineering/QC can read, only Design/Engineering
  can still create (POST unchanged). Read-only widening, not a Calc-write grant to QC.
- `lib/qc-document-fields.js`: `drawing_no`/`drawing_no_from`/`drawing_no_to` removed from
  `QC_HEADER_FIELDS` (the shared registry both the creation sheet and edit sheet render off, and
  both `app/api/qc-documents/route.js`'s creation validation and `app/api/qc-documents/[id]
  /route.js`'s PATCH validation derive their required-field/editable-field lists from) — confirmed
  by reading both consumers that removal cascades cleanly with no other hardcoded reference to
  those three keys anywhere.

## Verified live (this session, `shanti-ops-calc` preview, project SB-1040)

1. Login as `design_head` triggered the one-time migration (~22s against the real remote Turso DB)
   with no errors.
2. Calc-sheet selector: `CS-000010 · Tagging Test Sheet` (backfilled code, real existing row).
3. Sheet workspace sidebar: truncated `CS-00001…` chain label renders correctly.
4. Drawings tab: `DG-000030 · GA Drawing Test` (backfilled code, real existing row).
5. Created a new drawing ("DG- Verification Test") → minted `DG-1001` (counter format, correctly
   distinct from the padded backfill range) — confirms `nextNumber('drawing_no','DG')` wiring end
   to end through `addDrawing` → `getCalcDrawings` → the UI.
6. Login as `qc_head` (real QC document `SBH-TEST`, id 41, project SB-1040): the document header no
   longer shows the old `drawing_no`/`drawing_no_from`/`drawing_no_to` inputs at all (confirmed
   absent, not just disabled). Created a real Form III A group — its "Drawing No." field renders as
   a `SearchableSelect` picker (not free text), and the dropdown listed both real project drawings
   with their live `dg_no` codes (`DG-000030 · GA Drawing Test`, `DG-1001 · DG- Verification Test`)
   — confirms `requireCalcReadAccess` correctly lets QC *read* Calc's drawing list. Attempted a
   direct write (`PATCH /api/calc-drawings/30`) as `qc_head` → got a real `403`, confirming QC still
   cannot write to Calc (read-only widening only, as designed). Linked a drawing via the picker →
   persisted correctly across reload.
7. `BoilerDetailsSheet`'s "Drawing No's" field: confirmed read-only (a `<p>`, no input), showed "No
   approved drawings on this project yet" with zero approved drawings, then `DG-000030, DG-1001`
   once two drawings on the project were set to `status='approved'` (via direct DB update — approval
   is Design's existing action, untouched by this round, not worth re-testing here).
8. **The actual generated PDF** (`GET /api/qc-documents/41/pdf`, 20-page real document, 221 parts) —
   extracted text per-page with `pdfjsLib` (already loaded client-side for the preview) rather than
   screenshotting, to keep verification cheap. Confirmed all three independent print sites agree:
   covering-letter manifest line ("As built Drawings 1 set (Drawing No's DG-000030, DG-1001)"), Form
   III's "Drawing no. : DG-000030, DG-1001", and the Form III A group page's "Drawing No. :
   DG-000030" (the specific linked drawing, not the whole-project list) — exactly the derived,
   comma-list, read-only behavior this round was designed to produce. Test group and the two
   approvals were reverted afterward (direct DB cleanup) to leave the seed data as found.

One real bug found and fixed during this pass: `components/QcDocumentEditor.jsx` already imported
`SearchableSelect` (for the existing part-move picker); the new import added for the drawing picker
created a duplicate binding, which is a hard webpack build error, not a runtime one — caught
immediately on first page load (`GET /projects/50/qc/41` 500'd with a clear "defined multiple
times" message). Fixed by removing the duplicate import; the already-present one covers both uses.

## Files (current state)

**New:** `drawing-numbering-changes.md` (this file).
**Modified:** `lib/db.js` (3 `addColumn`, 2 backfills + registration, 2 stale-comment fixes),
`lib/calc.js` (mint in `addDrawing`/`createCalcSheet`, `dgNo` mapping, `requireCalcReadAccess`),
`lib/entity-ref-tokens.js`, `lib/entity-refs.js`, `lib/data.js` (`getDrawingRegisterLines`,
`getProjectBom`'s `drawing_dg_no`, `getProjectDesignSummary`'s `csNo`, `getQcDocumentDetail`'s
`linked_drawing_dg_no`/`approved_drawing_codes`), `lib/reports/render.js`
(`DRAWING_REGISTER_COLS`), `lib/qc-folder-pdf.js` (4 drawing-number print sites),
`lib/qc-document-fields.js` (3 fields removed), `app/api/calc-drawings/route.js`
(`requireCalcReadAccess` on GET), `app/api/qc-documents/[id]/iiia-groups/[groupId]/route.js`
(`calc_drawing_id` PATCHable), `components/CalcWorkspace.jsx`, `components/DesignPanel.jsx`,
`components/PortalOrderProgress.jsx`, `components/BomTable.jsx`, `components/PrWorkspace.jsx`,
`components/QcDocumentEditor.jsx` (drawing picker + read-only derived display),
`components/reports/DrawingRegisterCard.jsx`, `app/calc/project/[projectId]/page.js`,
`app/calc/project/[projectId]/[sheetId]/page.js`.
