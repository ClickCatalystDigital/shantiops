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

## Status: implementation complete, not yet browser-verified for the QC half

Everything through "new drawing mint" was verified live (see below). The QC canonical-drawing-number
work (IIIA group picker, folder-manifest derivation) was implemented but the session ran out of
budget before click-through verification — flagged explicitly, not silently assumed working.

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

## QC wiring (implemented, not yet browser-verified)

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

## Not yet verified — pick up here in a fresh session

- Entity-ref tagging end-to-end: raise a task referencing a real `DG-1001`/`CS-000010` plus fakes
  `DG-9999`/`CS-9999`; confirm real ones render as links with tooltips (`DG-` → project page, `CS-`
  → the exact sheet URL), fakes degrade to plain text, `@`-picker's "Drawing"/"Calc Sheet" chips
  live-search correctly, and a bare `DWG-1` now degrades (token retired).
- Reports: Drawing Register report's new "Drawing No." column, on-screen and in the Excel export.
- QC — the whole canonical-drawing-number half of this round is implemented but unclicked:
  - IIIA group drawing picker (`requireCalcReadAccess` actually lets a `qc_head` login list a
    project's drawings; linking one; the group's printed `drawing_no` becomes the linked `dg_no`).
  - `BoilerDetailsSheet`'s new read-only "Drawing No's" display.
  - The folder PDF itself (`GET /api/qc-documents/[id]/pdf`) — confirm the manifest line and every
    form page (XVII/III/IIIA/TC) print the derived comma-list correctly, that a non-approved
    drawing on the project is excluded, and that the line degrades sensibly when a project has zero
    approved drawings.
  - Document creation/edit sheets no longer show or require the three removed drawing_no* fields.

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
