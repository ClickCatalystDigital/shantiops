# QC Statutory Folder — design reference

**Status:** design analysis (2026-08-16) — **and now built as a first pass** (`lib/qc-folder-pdf.js`,
`lib/qc-entities.js`, `lib/qc-models.js`, `qc_mountings` table). This document is still the reference
for what's real vs simplified; SYSTEM.md §5d has the as-built pointer.

**What the app generates today:** one combined PDF — Label → Covering letter → Mounting list → the
project's model-specific forms (§3) → every linked cert's own source PDF appended at the end (via
`pdf-lib`, merging each cert's uploaded R2 file after the last form). Content for the identifying
fields (§4) is real; **full legal boilerplate paragraphs and the Form III sub-tables (Drums/Headers,
Parts-outside-works, the full Safety Valve block) are simplified, not verbatim** — flagged inline in
`lib/qc-folder-pdf.js` with a `ponytail:` note. Not yet tested against a cert that actually has an R2
PDF attached (none of the seed certs do) — the merge code path is unexercised in practice so far.

**Letterhead has no logo.** `public/logo.svg` is the SBOPS *app's* own icon, not a Shanti Boilers /
Shanti Techno Fab company logo — using it on a government submission would be wrong, so the letterhead
stays text-only until a real company logo file is provided.

---

## 1. What a complete folder is

A statutory folder is submitted to the **Directorate of Boilers, Telangana** for every unit. Physical
running order (client-confirmed):

1. **Documentation Label** — folder cover/spine label (position not 100% confirmed; treat as the
   front cover).
2. **Covering letter** — submission letter to the Director of Boilers, listing the folder's manifest.
3. **Mounting list** — list of mountings & fittings.
4. **The statutory forms** — set depends on the model (see §3).
5. Supporting docs — material inspection / **stage-wise report**, RT report, heat-treatment chart,
   material test report, rub-off, etc.
6. **The Test Certificate copies** themselves.

**Mandatory in every folder:** covering letter, mounting list, and label — even when a given sample
happened to omit one, the client says all three are always required.

Decisions locked (2026-08-16): **one equipment model per folder**; output is **one combined
multi-page PDF** in this order (not separate downloads).

---

## 2. The three axes of variation

Everything that changes between folders reduces to three independent sources:

### A. Entity — selected by maker-number prefix (NOT picked manually)
| Maker-no prefix | Legal name | Ref prefix | Notes |
|---|---|---|---|
| `SB-` | **Shanti Boilers & Pressure Vessels (P) Ltd** (P-10-10, Road No.5, IDA Nacharam, Hyderabad) | `SB/QC/OW/` | most boilers, SIB, PRS |
| `STF-` | **Shanti Techno Fab Pvt Ltd** (Kucharam, Hyderabad) | `STF/QC/OW/` | STF-prefixed boilers, steam headers |

This is a **correction** to an earlier note: it is the *same two* companies the app already has, but
the first one's real legal name is "Shanti Boilers & Pressure Vessels", and the entity is **derived
from the prefix**, never chosen by hand. The entity supplies: legal name, address, letterhead,
signature block, and the covering-letter ref prefix.

### B. Model — drives the product noun and the form set (see §3)
Per-model config: `{ noun, forms[] }`. `noun` ∈ { Boiler, Steam Header, Pressure Reducing Station, … }.

### C. Project / boiler data — mostly already stored
On `projects` (customer) + `qc_documents` (boiler meta) + linked `test_certificates`.

---

## 3. Form set by model

Each form is a sheet in the model's workbook. **This is the biggest per-model difference.**

| Model | Forms in folder | Entity seen | Product |
|---|---|---|---|
| CF, MF, OF | Form II(1) + III + III A + IV A | STF / SB | Boiler |
| SF | II(1) + III + III A + IV A (+ Mountings sheet) | SB (STF drawings) | Boiler |
| **SIB** | **Form XVII** + III A + IV A | SB | Small Industrial Boiler |
| **PRS** | Form III + IV A ("4A") | SB | Pressure Reducing Station |
| **HEADERS** | Form III + Form III-H (2026-08-24, real sample SB-IBR-SH-1100A/B, entity SB) — see note below | SB / STF | Steam Header |
| FCB, FAB | **unknown — no sample yet** | ? | ? |

Form roles:
- **Form IV A** — master TC summary table for *every* part. **Built today.**
- **Form III A** — same shape as IV A but for one named part (e.g. feed pipeline), with two **extra
  columns not in IV A and not stored on `test_certificates`**: *Steel Making Process*, *Heat
  Treatment*.
- **Form III** — boiler description block (dimensions/pressures/heating surface/evaporation/steam
  temp — overlaps `qc_documents` meta) + parts-manufactured list + construction/seams + drums/headers
  tables (often "Not Applicable") + mountings ref + safety-valve test.
- **Form II(1)** — Certificate of Inspection (inspecting authority, W.P., hydro test pressure + date,
  drawing numbers, stamps, signatories). Mostly **new fields**.
- **Form XVII** (SIB) — Certificate of Manufacture & Test for Small Industrial Boilers (Chapter XIV);
  replaces II(1)+III for that model.

---

## 4. Per-document field map (fixed vs variable → source)

Legend for source: **T** = template/boilerplate · **E** = entity (prefix) · **M** = model ·
**D** = existing project/document/cert data · **N** = new data to capture.

### 4.1 Documentation Label (2-up cover card) — nearly all derivable
| Field | Src | Where |
|---|---|---|
| Heading, labels, 2-up layout | T | — |
| Makers Name | E | entity |
| Type of Boiler | D | `qc_documents.boiler_type` |
| **Model code** (`SBH-OF-WB-100-10.54`) | N | **manual free-text field** (format not yet formalized; mature later) |
| Maker Number | D | maker's no |
| Working Pressure | N | new **W.P.** field (distinct from hydro/tested-to) |
| M.C.R | D | `evaporation_capacity` |
| Year of Make | D | `year_of_make` |
| Client | D | project `customer_name` |

### 4.2 Mounting list — new per-boiler table
Fixed: title + columns `SL No | Description | Size | MOC | SL Number | Make | Qty`. Everything else is
**new (N)** — one description row can hold several physical serial numbers. Also produces two
covering-letter counts (mountings, valve/mounting TCs).

### 4.3 Covering letter
| Part | Src | Where |
|---|---|---|
| Skeleton (Ref/Date/To/Sub/body/enclosures/sign-off) | T | — |
| Ref prefix + signing company | E | entity |
| Ref number (`…/1097`, `…/EXP-09`) | D | numeric part of maker no |
| Product noun ("Boiler"/"Steam Header") | M | model |
| **Which forms appear in the manifest** | M | model form-set (§3) |
| Maker no, drawing-number range | D | project/document (drawing no is a *range*) |
| Recipient | T | default **Director of Boilers, Hyderabad** (customer override) |
| TC counts by type (BQ plate, stay tubes, stay rod, seamless pipes, fittings) | D/N | derivable *if* certs are categorized by part type; else manual counts |
| Mounting / valve-TC counts | D | from the mounting list (§4.2) |
| Supporting-doc counts (Rub Off, RT report, heat-treatment chart, material test report) | N | external attachments — capture counts |
| Date, QC engineer (signer) | N | date defaults to today; signer = QC user |

---

## 5. New data to capture (the only real gaps)

1. **`qc_mountings`** child table (per document): `sl_no, description, size, moc, serial_numbers,
   make, qty`. Feeds the mounting page + two manifest counts.
2. **`qc_documents` additions:** distinct `working_pressure`; `drawing_no_range` (from/to);
   `label_model_code` (manual); covering-letter meta — `submission_date`, `signer_name`,
   `recipient` (default Director of Boilers), and small counts/attachments for external supporting
   docs (rub-off, RT report, heat-treatment chart, material test report).
3. **Cert extras for Form III A:** `steel_making_process`, `heat_treatment` on `test_certificates`
   (III A needs them; IV A doesn't).
4. **Entity config** keyed by prefix (`SB-`/`STF-`): name, address, letterhead, ref prefix. Reconcile
   the current two-value company list (`StatutoryDocsPanel.jsx`) — first entity's legal name is
   "Shanti Boilers & Pressure Vessels".
5. **Model config** keyed by model code: `{ noun, forms[] }`.

Everything else is boilerplate, entity/model config, or already in the DB — including the whole label
and most of the covering letter.

---

## 6. Suggested build phasing

1. Entity + model config (small, unblocks noun/form-set/letterhead derivation).
2. `qc_mountings` table + editor in the document workspace.
3. `qc_documents` new fields + Form III A cert extras.
4. Generators, in folder order, reusing `lib/qc-doc-pdf.js`'s approach: Label → Covering letter →
   Mounting list → **Form IV A (exists)** → Form III A → Form III → Form II(1)/XVII → stage-wise
   report; then compose into **one combined PDF** selected by the project's model.

---

## 7. Open items (need client)

- **FCB, FAB** — no sample; unknown form set / product noun.
- ~~**HEADERS** appears in samples but is **not** in the defined model list...~~ **RESOLVED
  (2026-08-24).** It's a model — added to `QC_SERIES`/`MODEL_CONFIG`, `forms: ['III', 'IIIH']`. Full
  writeup: SYSTEM.md §5as.
- **Label MODEL code** and **project-number** formats — both manual for now, formalize later.
- Whether TC-by-type counts should be auto-derived (needs a part-type/category on certs) or stay
  manual on the covering letter.

## 8. Form III-A (Pipes) — scoped and ready to build, blocked only on one client confirmation

**Do this section first if a future session is asked to "add the fourth form" / "add pipe
certification."** The spec below is complete enough to build against without re-deriving anything —
the only missing piece is a yes/no from the client's compliance contact (see the gate at the bottom).

**Naming collision to resolve before touching code:** this app already has an entry called
`'Form III A'` (`lib/reports/... ` no — `lib/qc-folder-pdf.js`'s `IIIA_COLS`, used by CF/MF/OF/SF/SIB),
described in §3/§4 above as "same shape as IV A but for one named part." **That is almost certainly
NOT the same document as the IBR regulation's own Form III-A** — the real regulation's Form III-A is
titled *"Certificate of Manufacture and Test for Pipes"* (regulation 4(e)), a raw-material pipe
certificate, structurally different from the app's existing per-part-TC-table "Form III A". Confirm
which one the client actually means before writing any code — don't assume they're interchangeable
just because the label matches.

**Real source**: `/Users/pujan/Developer/FOLDER SAMPLE - FOR APP/IBR CERTIFICATES-FORMS index
(official list, all forms).pdf`, pages 22-23 — the authoritative blank form, not a filled sample (no
real client Form III-A sample exists yet; get one before finalizing pixel-level layout, same "don't
design speculatively" rule as everything else in this doc). Full field list already extracted:

- Header: Certificate No., Date, Name of part & Quantity, Drawing No., Maker's name and address,
  Customer's Name & Address, Design pressure (Kg/cm²), Design temperature (°C).
- **RAW MATERIAL** block: Process of manufacture, Fully Killed/rimmed, Chemical composition, Heat
  Number, Size, Test Certificate No. & Date, Name of the Steel Maker, Name of Inspecting Authority.
- **PIPES** block: Process of manufacture, Main dimensions, Tolerances, Specification, Bend test on
  pipe or weld, Flattening test, Other tests, Tensile strength, Chemical Composition, Heat treatment,
  Hydraulic test (Kg/cm²).
- Identification mark of Inspecting Authority/Well Known Pipe Maker.
- A metal-temperature stress table (columns 250°C through 600°C; rows Eₜ/Sc/Sr/MAWP) — only required
  when a pipe's working metal temperature exceeds 454°C (850°F) per the form's own note; likely `NA`
  for every real job so far (Header samples run at 185°C).
- Certification paragraph (working pressure/temp/test date, prose, same pattern as Form III-H's own)
  + two-stage sign-off: Maker's Representative/Maker, then Competent Person/Inspecting Authority-or-
  Well-Known-Pipe-Maker — same shape as `SignIIIH` (`lib/qc-folder-pdf.js`), reuse or clone it.
- **Real regulatory constraints, not just layout**: Note (3) on the form — *"For stock and sale
  purpose, one Form shall be issued for not more than five pipes"* (a real batching rule, not
  optional); Note (2) — fabrications made from pipes sourced elsewhere must cite that pipe's own
  Form III-A/cert, not restate its raw-material data.

**Build shape, mirroring exactly how Form III-H was added** (same session, same pattern — copy it):
1. `lib/qc-models.js` — extend `HEADERS`'s (or whichever model's) `forms` array with a new key, e.g.
   `'IIIA_PIPES'` (NOT `'IIIA'` — that key is taken by the unrelated existing form); add its
   `FORM_LABELS` entry.
2. `lib/qc-folder-pdf.js` — new dedicated page component (follow `FormIIIHPage`'s precedent: don't
   force it through the generic `FormTablePage`, this header block is too rich), new cols array for
   the per-pipe/lot table, wire a new `case` into `Folder()`'s `formPage()` switch.
3. Data: no new schema needed for the header fields (reuses `qc_documents` columns the same way
   III-H does); the ≤5-pipes-per-form batching rule (Note 3) may need UI/validation if it's actually
   enforced in practice, not just a formality — confirm with the client before building that part.

**The gate**: confirm with the user's compliance contact whether a standalone Form III-A is actually
issued for the pipes inside a Header/component assembly in practice, or whether Form III/III-H's own
tables (which already carry pipe rows, per the real SB-IBR-SH-1100A sample) are what's actually filed
— see the live conversation where this was first raised (2026-08-24) for the exact ambiguity. If
confirmed yes, this section has everything needed to build it in one pass, no further research.
