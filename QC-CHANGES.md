# QC Statutory Documentation & Test Certificate Bank — Changes Log

**Status:** New requirement — intake/requirements stage. Nothing built yet. Only the **SF series**
sample has been seen; the client named six more (MF, CF, SIB, FBC, PRS, Headers) and said each will
get its own sample. This is a separate, much bigger ask than the existing QC Test Records feature
(`qc_records` — hydro test/NDE/MTC log, pass/fail per test, `SYSTEM.md` §5b) — that module stays
as-is; this is additional.
**Purpose:** single source of truth for this feature while it's investigated and (eventually) built.
Once a design is agreed and shipped, fold the as-built behavior into `SYSTEM.md` (a new §5d) and mark
this file done — same lifecycle `PROCUREMENT-CHANGES.md` went through for the Procurement redesign.

**Source:** the client's chat message below, plus one real worked example —
`qc_master_folder.xlsx`, one boiler's complete statutory folder (Maker's No. SB-1037, "SF" series).

---

## 1. What the client asked for

Their message, verbatim:

> Format of our Boiler documentation. The letters mentioned in red are variable and the letters
> mentioned in black are fixed formats which don't change. We also want a data of the original TCs
> (test certificates), the numbers of which are used in the boiler folder.
>
> It's the statutory documentation required for each equipment to be made. There are a few Models
> of documents — SF series, MF series, CF series, SIB, FBC series, PRS, Headers. All are more or
> less the same. Will share each of a sample document.
>
> We have to have a Test Certificate data bank, which should be entered first with all parameters.
> When you are filing the document it should fetch from the TC data only. Failing which it should
> not move forward. Once you save the entire document, a PDF should come out.

In plain terms, three things are being asked for, in this order:
1. A **Test Certificate (TC) data bank** — a master list of test certificates entered once, with all
   their parameters, entered *before* any document work starts.
2. A **document-filing system** for each boiler's statutory paperwork, where the fields that should
   come from a TC are **fetched from the bank, not typed by hand**.
3. A **hard gate**: if the right TC isn't in the bank yet, the document can't be completed —
   "failing which it should not move forward," not a soft warning.
4. **PDF generation** once a document is saved.

## 2. What the sample confirms — this isn't hypothetical, it's a real worked example

**The document ID convention**: every page of one boiler's folder carries the same code — e.g.
`SBH-1037-SF-WB-300-17` — encoding the maker's number (1037), the series (SF), the boiler subtype
(WB = wet-back), and its pressure/capacity. This is the thread tying every form in one folder
together.

**One complete folder = four statutory forms** (verified directly against all four sheets of
`qc_master_folder.xlsx`):

| Form | What it is | Content |
|---|---|---|
| **Form-II(1)** | Certificate of Inspection | Directorate-of-Boilers (Telangana) header, maker's name/no., year of make, W.P., hydro test pressure/date, drawing numbers, signatures |
| **Form III** | Construction Certificate of Manufacture & Test | Boiler description (type, dimensions, design pressure, hydro test pressure, heating surface, evaporation capacity, steam temp), full parts list, construction details, Drums / Headers & Boxes tables (marked "Not Applicable" on this smoke-tube boiler), Mountings, Safety Valve test results, final compliance statement |
| **Form III A** | Certificate of Manufacture & Test for **one specific part** (this sample: the feed pipeline) | Design pressure/temp, dimensions, then a materials table with Cast No., Plate No., material spec, steel maker, Certificate No., and full chemical + physical test results — 7 rows on this sample |
| **Form IV A** | The master **Test Certificate summary** | The same materials table as Form III A, but for *every* part of the whole boiler — 44 part rows on this sample. This table *is* the TC data bank in miniature |

**What a Test Certificate record actually contains**, read directly off Form IV A:

`Part of boiler · Cast No. · Plate No. · Size (T/W/L) · Qty · Material Specification · Name of the
steel maker · Certificate No. · Chemical analysis (C, Mn, P, S, Si) · Physical analysis (Yield
Strength, UTS, Elongation, Bend/Flat test)`

**TCs are reusable master records, confirmed with a concrete example**: cast `386888` / plate
`3254770/1` (SA516 Gr.70, from SAIL, certificate `RCL/MTL/PLM/80839164`) is the source material for
at least 11 different parts on Form IV A — shell belt, stiffener rings, pad plates, lifting hooks,
mud-hole cover, gussets, and more, all cut from the same plate. Confirms the client's model exactly:
**Certificate No. + Cast No. is the natural key.** One mill test certificate covers one heat/cast,
which yields many plates, which get cut into many parts — the TC is entered once and referenced by
every part cut from that batch, not re-entered per part.

**The red/black convention, checked directly against the file's actual font colors** — the client's
description is accurate. On Form III, the fields genuinely marked red (filled in per boiler, not
fixed boilerplate) are: the document ID code, boiler type description, overall length, internal
diameter, design pressure, hydro test pressure, maker's number, year of make, heating surface area,
evaporation capacity, steam outlet temperature, and the drawing number. Everything else on the page —
labels, section headers, regulatory boilerplate paragraphs — stays black/fixed. Within the red
(variable) fields, there are two different sourcing rules: some (the materials-table columns on
Form III A / IV A) come from a TC record and must be gated on one existing; others (boiler
dimensions, design pressure, drawing numbers) are boiler-level facts typed once per boiler,
unrelated to any TC.

## 3. What the system must do

1. **Enter a TC first.** A record with all the fields listed in §2 — cast/plate number, material
   spec, steel maker, certificate number, full chemical + physical results — gets created before any
   document references it.
2. **Author a boiler's document by referencing TCs, not retyping them.** For each part in a form
   like Form III A / Form IV A, the user points at an existing TC (most naturally by Certificate No.
   or Cast/Plate No.), and the chemical/physical fields auto-fill from that record.
3. **Hard gate, not a warning.** If a part's required TC isn't in the bank yet, the document cannot
   be completed/saved — matches the client's "failing which it should not move forward" instruction
   literally.
4. **PDF on save.** Once a document is saved, generate a PDF matching the statutory form's layout —
   this is a real, government-facing document (Directorate of Boilers, Telangana), so the output
   needs to look like the actual form, not a generic printout.

## 4. Grounding in the current system

- **`qc_records` is real and stays separate.** Schema at `lib/db.js:207-219` — one row per test
  (`test_type`, `reference_no`, `result` pending/pass/fail, `inspector`, `tested_on`), whole-row QC
  ownership. UI in `components/QcPanel.jsx`, API at `app/api/qc-records/route.js` (+`[id]`), reads
  via `lib/data.js:216-217`, documented at `SYSTEM.md` §5b. It's a lightweight pass/fail log, not
  statutory-document authoring — no file/PDF storage, no per-part materials data. This new feature
  doesn't replace it.
- **The actual gap this fills**: `SYSTEM.md` explicitly lists "document management for
  drawings/IBR/QC certificates" as **not built** (~line 511) — there's currently no structured
  storage for certificates at all, just the pass/fail metadata log above.
- **Loose existing overlap on the Procurement side**: `bom_items.bqtc_ref` (`lib/db.js:198`) is a
  free-text column mirrored verbatim from the imported PMB spreadsheet (likely "BQ/TC ref"). It's
  unstructured and untyped — not a real link to any TC record — but its existence is a signal that
  Procurement already gestures at test-cert references today. Relevant to the open "who owns TC
  entry" question below.

## 5. Open Questions

**(a) Need the client's answer before this can be fully spec'd:**
- Do the remaining six series (MF, CF, SIB, FBC, PRS, Headers) use the same four forms
  (II(1)/III/IIIA/IVA), or different ones? Form III's own "Drums" and "Headers and Boxes" sections
  were marked "Not Applicable" for this smoke-tube boiler — presumably those get filled in for
  series that actually have drums or headers.
- Is one boiler = one PDF containing every applicable form, or one PDF per form?
- **Who owns entering the TC bank** — QC, or Procurement (since TCs physically arrive with purchased
  material from suppliers, and `bqtc_ref` above already hints at this)? This affects whether the TC
  bank connects to the Procurement data model (`suppliers`, `purchase_orders`) or is a standalone
  QC-only entity.
- **Safety Valve test certificate and Mountings** (referenced in Form III as a separate enclosed
  "Form IIIC" annexure) — do these get modeled as structured data too, or handled as an attached file
  outside this system?
- **Relationship to the existing QC Test Records feature** — does the Hydro Test entry already
  logged in `qc_records` become one input into this bigger document (e.g. auto-fill Form III's hydro
  test date/pressure), or are these two entirely separate systems the user fills in twice?

**(b) Our design decisions — deferred until (a) is answered and the remaining samples arrive:**
- TC bank schema (fields, how Cert No. + Cast No. is keyed/deduped).
- How a document's per-part fields bind to TC records, and how the save-time gate is enforced.
- PDF generation approach (template engine, layout fidelity to the statutory forms).

## 6. Future Enhancements (post-launch, not part of this pass)

- Cross-boiler TC search/reuse (the same cast/plate showing up across multiple boiler folders).
- TC expiry or traceability reporting.

## 7. Not started

Everything in §3 — no schema, no UI, no PDF template, no code. This document is the intake/
requirements record; nothing here has been built.
