# V2 Roadmap — Certificates, Procurement RFQ, Sales/Stores, In-Stock, Suppliers

**Status:** 🟢 Decisions locked (2026-08-04 discussion); **Groups 0, 1, 2, 3, and 4 built and
live-verified** the same day (Group 4's Master BOM stage viz deferred to Group 5 phase 5.0b, on
purpose — it visualizes stages Group 5 redefines). This file groups the changes from the client's V2 brief into
**independently shippable groups**, ordered so each one is additive and can be built, verified, and
committed on its own without breaking anything already live (SYSTEM.md is the as-built truth; don't
regress it). Same lifecycle as `PROCUREMENT-CHANGES.md` / `QC-CHANGES.md`: this is the working spec
while V2 is built; each group folds into `SYSTEM.md` once shipped, and this file stays as the
record. Every 🔴 "needs decisions" item from the first draft has been resolved — see **Decisions
locked** below. Mail sending is **deferred** (D19). Real master-data files (vendor/customer/item)
arrived and vendors are imported live — see Group 3. R2/AI infra (Group 0) and the Certificates bank
PDF upload/AI-populate/delete flow (Group 1) are built and verified to degrade gracefully with R2/
OpenRouter credentials still unset — the client is adding the R2 values separately. Statutory
documents' add/remove-parts and two-company support (Group 2) are built and live-verified, including
a real byte-level PDF comparison between both companies. **Group 5 is complete** — phases 5.0
(data-model foundation + the D4 status-enum rename), 5.0b (Master BOM stage visualization), 5.1
(Enquiry tab + RFQ + supplier portal + draft-send, 2026-08-04), Bundle A (5.2 unified PR flow + 5.3
PO editing), and Bundle B (5.4 direct cancellation + the 5.5 remainder) are all built and
live-verified as of 2026-08-05. **Group 6 (Sales/Stores/In-Stock/SAS) remains unstarted.**

**Two rules for the whole round (from the client):**
1. **Do not spoil current progress.** Every group below is *additive* — a new column (always via
   `addColumn()` with a safe default, never `ALTER TABLE`), a new tab, a new status value, a new
   route. Where a group changes an existing surface (nav label, PDF header, moving a card, an enum),
   it's called out explicitly with the guard that keeps the old behavior intact.
2. **Test in groups, not per-change, to save tokens.** Each group (or phase, for the big ones) has
   ONE consolidated verification at the end. Build the whole group, verify once, commit once. Don't
   start a preview server per edit. Stick to this list — new ideas get appended here as questions,
   not built on the spot.

**Legend:** ✅ READY = buildable now · 🟡 READY, pending one business-data input · ⛓ depends on an
earlier group's foundation.

---

## Decisions locked (2026-08-04)

The authoritative decision log. Anything not here was never in question.

| # | Decision | Choice |
|---|----------|--------|
| D1 | RFQ vs current flow | **Enquiry replaces Sourcing**; Selection stays **manual**; keep manual quote-add + comms. |
| D2 | Never lose quotes | `supplier_quotes` stays append-only (already is). Add **`is_selected` tri-state**: `null` = undecided, `1` = selected, `0` = rejected. Winner=1, its siblings=0 on select; reset to null on undo. Training signal for later "learning mode." |
| D3 | PR model | **First-class entity** — `purchase_requisitions` header + `pr_items` membership carrying **qty-per-project split**. An RFQ is created from a PR (or from loose items). |
| D4 | `purchase_status` enum | **Rename to a clean lifecycle:** `Enquiry → Comparison → Ordered → Transit → Received \| Cancelled \| In-Stock`. (Was PENDING/TRANSIT/CLOSED/RECEIVED/CANCELLED.) Open = {Enquiry, Comparison, Ordered, Transit}; closed = {Received, Cancelled, In-Stock}. |
| D5 | "Ordered" vs "Purchased" | **Ordered** (pairs with Transit; matches PO-issued semantics). |
| D6 | In-Stock | **Terminal status** (`In-Stock` = fulfilled from existing inventory, never procured) **AND** a separate **source field** — because extra/trade items still traverse the real Enquiry→Received stages, so their *status* can't be In-Stock. (Client's open/closed count was correct; the source field exists only for that build/trade case.) |
| D7 | Source field values | **`bom` / `stock` / `sas`.** `bom` = project BOM item (default, `project_id` required). `stock` = extra/frequently-used (lands in inventory on Received, `project_id` optional). `sas` = Sold As Such / trade (needs `sale_order_no`, `project_id` null). |
| D8 | Inventory storage | **New project-less `inventory_items` table** (on-hand, location, reorder point). `bom_items.project_id` stays `NOT NULL`; project rollups stay clean. Stores owns it. |
| D9 | In-Stock qty semantics | Marking In-Stock **decrements on-hand** (with a Stores confirm step); a `stock`-source item hitting Received **increments** it. Keeps inventory numbers real. |
| D10 | Cancellation | Eng & Design can cancel at **Enquiry / Comparison / Ordered**; **blocked once Transit** (shipped). An Ordered-stage cancel **notifies Procurement to void the PO** with the supplier. |
| D11 | PO editing | Pencil in the PO table. **Change supplier** → insert a new quote (`is_selected=1`), re-point selection, redraft PO. **Edit qty/price** → change the **`po_items` snapshot** (+ `bom_item` qty); the quote log stays immutable. Propagates to Selection/Enquiry views. |
| D12 | Supplier portal auth | **Token link per supplier per RFQ, 14-day expiry**, no login. Re-send = fresh token. |
| D13 | RFQ send | **In-system draft preview first** (recipients + composed message + item list + portal link). WhatsApp = `wa.me` click-send. **Email = shows the same draft** (no auto-send yet — see D19). |
| D14 | Sale Order | **Free-text `sale_order_no`** on trade items for now (Sales keeps a simple list). Upgrade to an entity later — additive, no migration pain. |
| D15 | Exception cards | Rename to **"Incoming Incidents" / "Outgoing Incidents"** and move from Requests tab to the **Operations** Procurement view. |
| D16 | Supplier approvals | New **Suppliers section in the Approvals tab** (reuses the existing People/Devices/Browser hub + approval hierarchy). |
| D17 | Two companies | New `qc_documents.company` column + a `COMPANY_PROFILES` map read by the PDF. Default reproduces the current Shanti Boilers output byte-for-byte. |
| D18 | Demo/seed data | **Wipe all current data; reseed one minimal, obviously-synthetic single-project dataset** (`scripts/reset-demo.mjs`) — easy to delete when the real master Excels arrive. No attachment to real data until the suppliers/customers/items masters are imported. Reseedable → zero risk to change or drop what exists now. |
| D19 | Mail transport | **Deferred — not built.** The RFQ email action just **shows the same in-system draft** (no auto-send, no transport, no `lib/mail.js`). WhatsApp stays `wa.me` click-send. Revisit when real sending is wanted (Resend/Zoho/SMTP). |

**Answered, factual:** BOM data **already has `project_id`** (`bom_items.project_id NOT NULL`,
`lib/db.js:166`) — the per-tab project-id columns are display-only, no migration. Shown **per line**
(a PO/PR can span projects).

---

## Group ordering (build in this order)

| # | Group | State | Depends on |
|---|-------|-------|-----------|
| **0** | Infra: Cloudflare R2 + AI extraction | 🟢 built, verified degrading gracefully; R2 values pending | — |
| **1** | Certificates bank — PDF upload + AI populate + delete/edit | 🟢 built + live-verified | Group 0 |
| **2** | Statutory documents — add/remove parts + two companies | 🟢 built + live-verified | Group 3 |
| **3** | Master data — suppliers/customers/items import | 🟢 suppliers live (445); customer/item await a UI home | — |
| **4** | Procurement housekeeping — project columns, card move+rename (4c viz → Group 5) | 🟢 built + live-verified | — |
| **5** | Procurement data model + RFQ/Enquiry + PR + PO editing + cancellation | 🟢 complete — all phases 5.0–5.5 built + verified | Group 3 ⛓ |
| **6** | Sales dept + Stores inventory + In-Stock + SAS trading | ✅ READY (phased) | Group 5 foundation ⛓ |

**Build order:** 0 → 1 → 2 → 3 → 4, then Group 5 phase-by-phase, then Group 6 phase-by-phase.
Groups 0–4 are small and independent. Groups 5–6 are large but now fully specified — they ship in
the phases listed, one verification per phase, not one giant drop.

---

## Group 0 — Infra: R2 + AI extraction 🟢 built (R2 values pending)

Built 2026-08-04. R2 bucket itself still pending from the client (values to arrive same day) — the
code path is designed to degrade gracefully in the meantime, not block anything on it.

- **`lib/r2.js`** — `putObject`/`deleteObject`/`getObjectBuffer`, `@aws-sdk/client-s3` `S3Client`
  (installed), `endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`. **A `required()` guard
  checks all four R2 env vars up front** and throws a clear "R2 not configured yet (missing …)"
  instead of letting the SDK attempt a network call against `https://undefined.r2...` — callers treat
  this as best-effort/non-fatal (see Group 1). `getObjectBuffer` added beyond the original plan, for
  the proxied-preview route (Group 1) — reading back through the app rather than requiring
  `R2_PUBLIC_DOMAIN_URL` to be set.
- **`lib/extract.js`** — `extractFields(buffer, prompt)` via OpenRouter. **Request shape mirrors
  ls_crm's `callOpenRouter`/`parseInvoice` exactly** (checked the real source, not guessed): a
  base64 `file` content part + the `file-parser`/`pdf-text` plugin + fence-stripped JSON parsing with
  a brace-slice fallback. Throws a clear "AI extraction not configured yet" if
  `OPENROUTER_API_KEY` is unset, same non-fatal treatment.
- **No mail transport (D19)** — unchanged, still deferred.
- **Env added to `env.example`:** the 5 R2 vars + `OPENROUTER_API_KEY` +
  `EXTRACTION_MODEL=google/gemini-2.5-flash`, with comments explaining the graceful-degradation
  behavior when unset.

**Doesn't spoil anything:** new files + env vars + one new dependency; nothing else imports them
except Group 1's routes.

**Verified (2026-08-04, live, no R2/OpenRouter credentials set):** both `extractFields` and
`putObject` were exercised through the real routes (see Group 1) and failed with their exact
intended messages — `"AI extraction not configured yet (OPENROUTER_API_KEY not set)"` (502) and
`"R2 not configured yet (missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET_NAME)"` (502) — never an unhandled crash or a confusing SDK network error.

---

## Group 1 — Certificates bank: PDF upload + AI populate + delete/edit ✅ built

Client point 1, first half. Built and live-verified 2026-08-04. Surface: the **`/qc` top-nav tab**
(`TcBank.jsx`) + its Add-certificate side overlay (`CertForm.jsx`).

- **Nav label `QC` → `Certificates`** (`Nav.jsx`) — route/gate/department untouched. **Verified**:
  logged in as `qc_head`, nav shows "Certificates," active on `/qc`.
- **PDF upload in the overlay, left column** (`CertForm.jsx` widened to `sm:max-w-3xl`, two-column
  grid — stacks to one column on mobile). Picking a PDF (Add-flow only) calls
  `POST /api/test-certificates/extract` → best-effort AI populate of the empty-safe field set
  (`EXTRACTABLE_FIELDS`) → human reviews/edits → existing Add/Save button unchanged. **Edit-flow**
  lets you attach/replace a PDF too, but deliberately skips auto-refill on pick — never silently
  overwrites an already-correct saved value.
- **Inline PDF preview, not the popup dialog** — new `components/PdfInlinePreview.jsx`, a lighter
  sibling of `PdfPreview.jsx` (same `pdfjs-dist/legacy` + static-worker approach, SYSTEM.md §5d's
  build gotcha applies here too) that renders directly in the left column instead of a `Dialog`.
  First page only (cert scans are effectively always single-page; a "Page 1 of N" note covers the
  rare multi-page case). Reads bytes straight from the local `File` before the cert row even exists,
  or from the proxied PDF route once one's saved.
- **PDF storage, proxied through the app, not a raw R2 URL:**
  `POST /api/test-certificates/[id]/pdf` (attach/replace, called right after create/edit succeeds —
  separate from the JSON-only create/edit routes, which are unchanged) and
  `GET /api/test-certificates/[id]/pdf` (streams the object back with `Content-Type: application/pdf`
  — works whether or not `R2_PUBLIC_DOMAIN_URL` is set, `PdfPreview.jsx` just does a plain `fetch`).
  New `pdf_key`/`pdf_url` columns on `test_certificates` (`addColumn()`).
- **View an existing cert's PDF** — small "PDF" affordance on each `TcBank` row (only shown when
  `pdf_key` is set), reusing `PdfPreview.jsx` as-is (the popup *is* the right call once a PDF is
  actually saved and you're just looking, vs. the inline-while-editing case above).
- **Delete + edit.** `PATCH` already existed (built in the original QC V1 round, not new). Added
  `DELETE /api/test-certificates/[id]` — deletes the R2 object first (best-effort; a missing/already-
  failed R2 object doesn't block deleting the row) then the row. **Guard:** 409s with "Still used by
  N statutory-document part(s)" if any `qc_document_parts.test_certificate_id` still points at it —
  no cascade. Delete button added to `CertForm`'s footer (edit mode only), mirroring
  `SupplierEditForm`'s destructive-action placement in `ProcurementWorkspace.jsx`.
- **Graceful degradation (client's explicit ask, R2 not set up yet):** creating/editing/deleting a
  certificate **never depends on R2 or OpenRouter being configured** — both failure paths are caught
  and surfaced as a toast ("Certificate added, but the PDF couldn't be uploaded (…)") without failing
  the save. The cert row is always the source of truth; the PDF is best-effort on top of it.

**Doesn't spoil anything:** additive columns + new routes; the existing add flow, duplicate-key
rejection, and the pre-existing `PATCH` route are all unchanged.

**One bug found and fixed live:** the PDF-proxy `GET` route returned "No PDF on file" for a
certificate that had been *deleted*, same as one that simply had no PDF — misleading. Fixed to check
existence first (`"Not found"`) before checking `pdf_key`.

**Live-verified end-to-end, 2026-08-04** (dev server, real session, a real PDF — not just synthetic):
- `extract` on a real PDF with no `OPENROUTER_API_KEY` → clean 502, exact expected message.
- Created a certificate (JSON, unaffected by any of this) → attached a PDF with no R2 creds → clean
  502, exact expected message, **certificate row still saved** (the graceful-degradation goal).
- GET proxy on a cert with no PDF → clean 404.
- Linked the cert to a real statutory-document part (via the existing `qc-documents/link-parts`
  route) → attempted delete → **409, "Still used by 1 statutory-document part"**, exactly as
  designed. Removed the link (deleted the test document, cascades) → delete succeeded → GET proxy on
  the now-deleted cert → **404 "Not found"** (post-fix).
- UI walkthrough as `qc_head`: nav label, two-column overlay, "Upload PDF" button, "No PDF attached
  yet" placeholder, "Add certificate" button all render correctly; no console errors traceable to any
  new/changed component (one pre-existing Radix `SheetOverlay` ref-forwarding warning noted, present
  in the shared `sheet.jsx` primitive independent of this change).
- A full `npm run build` after every edit compiled clean throughout.

---

## Group 2 — Statutory documents: add/remove parts + two companies ✅ built + live-verified

Client point 1, second half. Built and live-verified 2026-08-04. Surface: **Project → QC tab**
(`StatutoryDocsPanel.jsx`, `QcDocumentEditor.jsx`).

**Business facts, resolved 2026-08-04** (the only real blocker — the code was always simple):
- Directorate-of-Boilers/Telangana question turned out to be **moot** — Form IV A's actual PDF
  (the only form V1 builds) has no state/Directorate header line at all; that only applies to Form
  II(1), not built. Confirmed by reading `lib/qc-doc-pdf.js` directly, not assumed.
- STF's legal name/address/GSTIN: **sourced from the client's own Vendor master** (Group 3's import,
  row 330 — STF is a real Shanti Boilers vendor) — Legal name **SHANTI TECHNO FAB PVT LTD**, address
  `Survey No. 128/E3, Kuncharam Village, Toopran Mandal, Medak, Telangana - 502336`, GSTIN
  `36AAVCS1802J1Z1`. Client-confirmed usable.
- Phone: **omitted** (not on file) — client-confirmed, add later via a one-line
  `COMPANY_PROFILES` edit rather than guessing a number.
- Doc-ID prefix: **`STF-<digits>-SF-`** (client-confirmed), mirroring Shanti Boilers' `SBH-` scheme.
- Letterhead: **text-only**, same as Shanti Boilers (client-confirmed) — no image-handling added.

**Shipped:**
- **Add/remove parts** (client point 1: manage per-document exceptions beyond the 54-part SF seed).
  `POST /api/qc-documents/[id]/parts` (insert, starts unlinked, `sort_order = max+1`) and
  `DELETE /api/qc-documents/[id]/parts/[partId]` (ownership-scoped to the document — a stray part id
  from another document 404s, same trust-boundary reasoning as `link-parts`). UI: an "Add part"
  button (small `Dialog`, not a full `Sheet` — a handful of short fields) and a trash icon per row in
  `QcDocumentEditor.jsx`, both `canEdit`-gated. **The hard gate is unchanged** — Preview PDF still
  409s server-side if any *remaining* part is unlinked; no template change, this only manages
  per-document exceptions.
- **Two companies.** New `qc_documents.company TEXT NOT NULL DEFAULT 'Shanti Boilers'`
  (`addColumn()`). `lib/qc-doc-pdf.js`'s two hardcoded spots (header, signatory) replaced with a
  `COMPANY_PROFILES[document.company]` lookup, defaulting to Shanti Boilers for any unrecognized/
  missing value. Company picker (`Select`, first field) in `StatutoryDocsPanel.jsx`'s New-document
  sheet, wired into the same "suggest doc_id from Maker's No. until touched" logic — now company-
  aware (`SBH-`/`STF-`). Also editable later via `QcDocumentEditor.jsx`'s "Edit boiler details"
  sheet (one field in `HEADER_FIELDS` special-cased to render a `Select`). Both `POST`/`PATCH`
  routes validate against the known-companies list, falling back to Shanti Boilers on create (never
  silently storing an unrecognized value) and rejecting outright on edit. The document list row and
  the editor's own header both show a company badge, so mixed-company documents in one project read
  clearly at a glance.

**Doesn't spoil anything:** additive column + new routes; a production build compiled clean.

**Live-verified end-to-end, 2026-08-04** (dev server, real session, real PDFs generated and
byte-compared — not just synthetic):
- Created a Shanti Boilers doc and a Shanti Techno Fab doc (both on the same real project), linked
  all 54 parts of each to a real certificate, generated both PDFs, extracted their text with
  `pypdf`: **Shanti Boilers' header/address/GST/phone render byte-identical to the pre-existing
  output** (regression check passed) and **STF's PDF shows its own legal name, address, GSTIN, no
  phone line, and the correct "For SHANTI TECHNO FAB PVT LTD." signatory** — confirmed on the
  signatory page specifically, not just the header.
- Add-part → PDF gate correctly re-blocks (409, "1 part still needs a certificate") → remove that
  same part → gate clears (200) again — the exact interaction the feature exists for.
- Guards: deleting a part via the wrong document's route → 404 (ownership-scoped); adding a part
  with no name → 400; creating/editing a document with an unrecognized company → falls back
  (create) / rejected (edit) as designed.
- UI walkthrough as `qc_head`: company combobox opens with exactly "Shanti Boilers" /
  "Shanti Techno Fab", selecting "Shanti Techno Fab" **live-updates the doc_id field from
  `SBH-1099-SF-` to `STF-1099-SF-`** (confirmed via direct DOM read, since this session's screenshot
  capture was intermittently unreliable — the accessibility tree and JS-evaluated DOM state gave
  solid ground truth throughout). Same pre-existing, unrelated `SheetOverlay` Radix warning noted
  again (now also from `NewDocumentSheet`) — confirms it's systemic to the shared `Sheet` primitive,
  not anything in this change.
- Test documents deleted afterward; no residue left in the real dev DB.

---

## Group 3 — Master data import: suppliers, customers, items 🟢 built (approval gate not yet)

Client point 5, plus the customer + item masters that arrived the same way. Real files supplied
2026-08-04 (STERP ERP exports): Vendor party master (445 rows), Customer party master (332 rows),
Item Master — Purchase (2,773 rows). **Key finding: the vendor and customer files are the identical
22-field "Party Master" template** — one parser feeds both. Unblocks Group 5 (RFQ needs a real
supplier list) and Group 2 (STF's identity, above). Makes the "provisional" `suppliers` table
(SYSTEM.md §5c) real.

**Shipped:**
- **`lib/master-import.mjs`** — parses the Party Master template (→ `suppliers`/`customers`) and the
  Item Master template (→ `items`). Unlike `pmb.mjs`'s multi-layout tolerant scan, these are single
  rigid ERP templates: header row found by exact-text anchor (scans every sheet, since the vendor
  file also carries two unrelated reference sheets — a GSTIN cheat-sheet, a state-code lookup — that
  must be skipped), columns mapped by exact normalized header text, and a row is data only if its
  identity field (Party Name / Item Name) is present — which alone skips every legend/summary/marker
  row with no special-casing. Self-check: `node lib/master-import-selfcheck.mjs` (synthetic fixtures)
  or `... party|item <file.xlsx>` (prints real counts/columns, no DB writes) — same precedent as
  `pmb-selfcheck.mjs`. Verified against all three real files: 445/332/2,773 rows, exact expected
  counts, only the item file's 1 marker row skipped.
- **Schema** (`lib/db.js`) — `suppliers` extended via `addColumn()` with the full party column set
  (`party_code, city, state, state_code, country, pin_code, area, fax, website, pan, excise_range,
  division, gst_trans_type, business_type`, +`address2`/`address3`; `name`/`gst_no`/`phone`/`email`/
  `address` reused). **`state`/`state_code` closes the IGST-vs-CGST/SGST gap** (SYSTEM.md §5c) — the
  source data even pre-computes `gst_trans_type` (Intrastate/Interstate/Export) per party. New
  `customers` table, identical column set (Sales-owned, distinct from `users` role=customer portal
  logins — a CRM/party record, not a login). New `items` catalog table (28 columns) — **catalog
  only** this round (client-confirmed): no `bom_items`/`inventory_items`/`pr_items` wiring yet.
  **No UNIQUE on `item_code` or `item_name`** — confirmed against the real file that `item_code` is
  populated on 1 of 2,773 rows and `item_name` has 22 legitimate duplicate pairs (spec/size variants
  sharing a label); enforcing uniqueness would have silently dropped real rows.
- **`POST /api/masters/[type]/import`** (`type` ∈ `suppliers`/`customers`/`items`) — one generic
  route, same two-phase shape as the BOM import (parse → mandatory preview → confirm). **Re-import is
  always a full replace** (client-confirmed, 2026-08-04: these are periodic whole-file STERP
  re-exports, not incremental edits; losing a stale `supplier_quotes`/PO link on a supplier replace
  is acceptable). Gated: suppliers → Procurement; customers → **PM-only for now** (no Sales
  department/head exists yet, Group 6.1 not built — loosen once it is); items → Engineering (mirrors
  the PMB import's gate).
- **`components/MasterImport.jsx`** — generic upload/preview/confirm dialog, parameterized by `type`.
  Wired into the existing **Suppliers tab** (`ProcurementWorkspace.jsx`, `CardAction` next to "Add
  supplier," same `CardHeader`/`CardAction` idiom as `BomPanel.jsx` — plain flex overrides don't work
  on `CardHeader`, SYSTEM.md §18 gotcha). **Customers and items have no dedicated import surface yet**
  — no Sales department (Group 6.1) or item-catalog screen exists to host the button; the API route
  and parser are ready, callable once those surfaces are built. Not scaffolded speculatively.

**Not yet built — separate from this import work:**
- **Approval gate for suppliers added *after* import (D16).** New `suppliers.status` (`active`/
  `pending`) + `added_by`; a manually-added supplier stays `pending`/unusable until approved by
  manager/executive (admin for now) via the existing approval hierarchy (`canApproveUser`,
  SYSTEM.md §2a), surfaced in a new Suppliers section on the Approvals tab. Deferred to keep this
  round scoped to the import pipeline itself; the bulk-imported 445 rows land `active` regardless.

**Doesn't spoil anything:** additive columns/tables + one new route; a production build (`npm run
build`) after every change compiled clean, including the new route and the updated `/procurement`
bundle.

**One real bug found and fixed while running the live import** (same "verify against real data,
not just synthetic fixtures" precedent as the Phase 4 polish pass, SYSTEM.md §5c) — the vendor
import 500'd on confirm: `purchase_orders.supplier_id` and `supplier_quotes.supplier_id` both
FK-reference `suppliers(id)` with no `ON DELETE` clause, and — unlike this app's local-sqlite
fallback, where FK enforcement is never turned on for plain `execute()` calls (SYSTEM.md §7's
`tickets` note) — **Turso does enforce FKs**, so a bare `DELETE FROM suppliers` was rejected outright
while the 3 demo suppliers still had quotes/POs against them. Fixed by clearing
`purchase_orders`/`supplier_quotes` first on a suppliers-type replace (client-confirmed acceptable,
D-decision above); `po_items` cascades from `purchase_orders` on its own. Preview now also reports
`dependentCounts` so the UI's warning is honest about what a replace actually clears, not just the
row count.

**Live-verified end-to-end, 2026-08-04** (dev server, real session auth, real file — not just the
self-check): logged in as `admin` → `POST /api/masters/suppliers/import` preview showed the
correct 445 rows / 3 existing / `{purchase_orders: 4, supplier_quotes: 25}` about to clear → confirm
→ `inserted: 445` → `GET /api/suppliers` confirmed 445 rows live, correct field mapping (state,
GSTIN, business type), and **Shanti Techno Fab's own row present** with the exact data now used in
Group 2 above. Customer and item imports are **not yet run live** — same route/parser, no UI surface
to trigger them from yet (see above); run the same way once Sales/item-catalog screens exist, or via
a direct `curl`/script call in the meantime if needed sooner.

---

## Group 4 — Procurement housekeeping 🟢 built + live-verified

Client point 2, the concrete/low-risk parts. Built and live-verified 2026-08-04. **Scoped down to
two parts** (decision, see below): the third part (Master BOM stage viz, "4c") is deferred to Group 5
because it visualizes the very stages Group 5 redefines — building it now would be an interim model
immediately relabeled. The data-model + RFQ parts stay in Group 5.

**Shipped:**
- **Project on the two tabs that lacked it (4a).** `project_no` was already shown inline on
  Sourcing/Selection/Status rows — it was genuinely missing only from **Purchase Orders** (a PO can
  span projects via `po_items.project_id`). `getPurchaseOrders()` (`lib/data.js`) gained two
  correlated subqueries — `project_count` (`COUNT(DISTINCT pi.project_id)`, NULL-safe) and
  `first_project_no` — and the PO tab (`ProcurementWorkspace.jsx`) now has a **Project column**
  showing the single `project_no`, **"Multiple"** when it spans projects, or `—`. **Status** got its
  inline project promoted to a real **Project column** (removed from the subtext to avoid
  duplication). Sourcing/Selection deliberately kept as inline card text (card rows, not a fixed
  grid — column headers were intentionally not added there in the Phase 4 pass, SYSTEM.md §5c).
  Suppliers is not item-based, untouched.
- **Moved + renamed the two incident cards (4b / D15).** The "Raised by/for Procurement"
  `TicketsPanel` instances moved from the **Requests** tab back to the **Operations** Procurement
  view (`app/page.js`), renamed **"Outgoing Incidents"** (Procurement → others, `showDepartment`) and
  **"Incoming Incidents"** (others → Procurement). Reuses the already-fetched
  `getDepartmentTasks('Procurement')` (finds Procurement's index in `tasksByDept`, no second query)
  with the exact `from_department`/`bom_item_id` filter the Requests page used. Removed the two panels
  + their props from `RequestsWorkspace.jsx` / `app/requests/page.js` (the now-unused `TicketsPanel`
  import too). The Requests tab keeps **New-item + Cancel requests only** — coherent as the acceptance
  inbox; those cards are removed later (Group 5.5) once Enquiry receives requests directly, not now.
  Cross-department task/reopen mechanism is unchanged (just new `title` props). PMs don't see the
  incident cards on Operations — same as every other department's `TicketsPanel` there (head-scoped
  via `deptsToShow`), consistent with the existing "PMs have no department task view" design (§8).

**Doesn't spoil anything:** two display-only columns + one data-layer subquery, and a card relocation
with the same backing data/mechanism. A production build compiled clean.

**Live-verified end-to-end, 2026-08-04** (dev server, real sessions — not just build):
- Constructed a real multi-project PO (quoted one supplier on items from SB-1104 + SB-1103, selected
  that supplier for both → one draft PO `593/SB/2026-27` spanning 2 projects) → PO tab renders
  **"Multiple"**; a single-project PO would show its `project_no`. Test PO/quotes cleaned up after.
- Status tab shows the Project column with `project_no`, subtext no longer duplicates it.
- As `procurement_head`: Operations shows **Outgoing Incidents** (Procurement → QC, Procurement →
  Design) and **Incoming Incidents** (from Design / Stores / Engineering) — direction split correct.
  Requests tab no longer shows those cards but still shows New-item + Cancel, both intact. No console
  errors.
- **One environment gotcha, not a code bug:** `/procurement` 500'd with a Next-internal
  `useContext of null` mid-verification — the `.next` corruption SYSTEM.md §20 warns about (build +
  dev in one tree). Fixed by the prescribed `rm -rf .next` + restart; the stack was entirely in
  Next's own runtime, never app code, and it hasn't recurred.

---

## Group 5 — Procurement data model + RFQ/Enquiry + PR + PO editing + cancellation ✅ (phased)

Client point 2, the big one — now fully specified. Ships in **7 phases** (5.0, 5.0b, 5.1–5.5), one
verification each. Depends on Group 3 (real suppliers). Core architecture: model around an **RFQ entity**
(`Request → RFQ → invite suppliers → quotes via token link → compare → award → PO`), giving a
permanent record. The supplier-portal schema was already flagged "ready" (SYSTEM.md §5c).

### Phase 5.0 — Data-model foundation (schema only, no UI) 🟢 built + live-verified 2026-08-04
The interdependent migration all later phases build on. All additive, all `addColumn()` / new tables.
- **`purchase_status` enum → D4** (`Enquiry/Comparison/Ordered/Transit/Received/Cancelled/In-Stock`).
  **Backfill existing rows** (demo data is reseedable, low risk): `TRANSIT→Transit`,
  `CLOSED→Received`, `RECEIVED→Received`, `CANCELLED→Cancelled`; `PENDING` splits by existing signal
  — has `po_ref`→`Ordered`, else has ≥1 quote→`Comparison`, else→`Enquiry`. One-off backfill in
  `migrate()`, idempotent (guarded by a cheap existence check, so a converted DB never re-scans).
  Vocabulary centralized in `lib/bom-fields.mjs` (`PURCHASE_STATUSES`/`OPEN_STATUSES`/
  `CLOSED_STATUSES`/`STATUS_TONE`/`isOpenStatus`/`isClosedStatus`) — every site that used to inline
  the old string arrays (`lib/data.js`, both purchase-order/bom-item/procurement-request/
  accept-cancellations API routes, `lib/pmb.mjs`'s status-word mapper, `BomTable.jsx`,
  `ProcurementWorkspace.jsx`, `ProcurementQueue.jsx`, `TicketsPanel.jsx`, the demo seed script) now
  imports from there. `lib/pmb.mjs`'s PMB-import status column now maps known freeform Excel words
  (`received`/`closed`/`pending`/…) onto the new enum instead of blindly uppercasing raw text;
  unrecognized text still passes through verbatim.
- **`bom_items.source`** → D7 (`bom` default / `stock` / `sas`) + **`bom_items.sale_order_no`** (D14,
  free text, for `sas`). Relax the app-level "project_id required" expectation for `stock`/`sas` only
  (column stays as-is on `bom_items`; PR items carry the multi-project split, see below).
- **`supplier_quotes.is_selected`** → D2 (tri-state, nullable) — **wired into the existing
  `POST`/`DELETE /api/bom-items/[id]/select-supplier` route** in this same phase (found while
  scoping: the column would otherwise sit permanently unpopulated, since no later phase's spec
  revisits this file). Selecting a quote sets it `is_selected=1` and every other quote logged
  against that item `=0`; undoing resets all of them to `NULL`. The append-only quote log itself is
  untouched — only this outcome flag moves.
- **`purchase_requisitions`** (header: id, pr_no, raised_by_dept, source, sale_order_no, status,
  awarded_supplier_id, created_by, created_at) + **`pr_items`** (pr_id, material_description, moc,
  size_spec, qty_text, sort_order) + **`pr_item_projects`** (pr_item_id, project_id, qty_text — the
  confirmed child-table shape for the per-project qty split, D3) — schema only, no read/write paths
  yet (Phase 5.2).
- **`rfqs`** (id, rfq_no, pr_id, status draft/sent/closed, created_by, created_at) +
  **`rfq_suppliers`** (rfq_id, supplier_id, token, token_expires epoch-ms — D12's 14-day portal
  link, sent_at, responded_at) + **`rfq_items`** (rfq_id, bom_item_id nullable, pr_item_id nullable
  — one join table covering both loose-item and PR-sourced RFQs) — schema only (Phase 5.1).
- **`inventory_items`** (D8: id, description, spec, on_hand, location, reorder_point, item_code) —
  created here, used by Group 6.

**Verified (2026-08-04, live, real Turso dev DB):**
- `node scripts/backfill-5.0-selfcheck.mjs` — 10 synthetic cases covering every old status + NULL,
  with/without `po_ref`, with/without a logged quote; asserts the exact new-status mapping and that
  a second pass is a byte-for-byte no-op (idempotency).
- `npm run build` clean, then `rm -rf .next` (SYSTEM.md §20 guard).
- Real dev DB before/after: `bom_items` row count unchanged (36→36, zero rows lost), every old
  token/NULL converted to a D4 value, every row has `source='bom'`, all 7 new tables present. A
  second `migrate()` pass (server restart) touched nothing — confirmed via the same guard query
  returning 0 rows.
- `node --env-file=.env.local scripts/seed-procurement-demo.mjs` reseeded clean on the new enum —
  445 suppliers intact, 0 dangling `supplier_quotes`→`suppliers` references.
- UI walkthrough as `procurement_head`: `/procurement` Status tab renders Enquiry/Comparison/
  Transit/Received/Cancelled (badges, correct tones) and its filter dropdown lists all 7 values
  incl. In-Stock; Operations' Procurement flow diagram and Master BOM card counts still render and
  the flow partition still sums to the whole (16 requests + 8+8+8+8+4 = 36 bom_items, matching the
  live row count). No console or server errors throughout.
- `is_selected` tri-state exercised end-to-end via the real route (not just schema): selecting a
  quote on a live Comparison-stage item set the winner `is_selected=1` and its sibling `=0`;
  undoing reset both to `NULL`, and the now-empty draft PO it had started was auto-deleted by the
  existing `removeItemFromDraftPO` logic, unchanged.

### Phase 5.0b — Master BOM stage viz + legend (deferred here from Group 4c) 🟢 built + live-verified 2026-08-04
Built **right after 5.0** so it's authored once, on the final stage names — not the current
soon-to-be-renamed ones (the reason it was pulled out of Group 4; client-confirmed 2026-08-04). The
client's ask (point 2): "better master BOM visualization... which stage and how many remaining, in
project view... simple legends like the milestone tracker."
- **No charting library added** — the repo has zero chart dependencies and the whole design system
  is hand-built Tailwind; `PortfolioDelayTimeline.jsx` (the Milestone Tracker) is already a premium
  segmented stage bar with a legend, so this reuses that exact idiom (pure flexbox + theme tokens)
  instead of introducing Highcharts/D3/etc. Visually rhyming with the bar users already read daily
  is what makes the new one immediately legible, not a new visual vocabulary to learn.
- **New shared component** `components/BomStageBar.jsx` — `<BomStageBar counts size>` (the
  segmented bar) + `<BomStageLegend>` (one legend per card, not per row), pure-props like
  `BomProgress.jsx`. **Semantic palette matching the Milestone Tracker's own tokens** (gray →
  pale-blue → blue → amber → green). **Active-pipeline bar + exits as side counts** (client-
  confirmed, 2026-08-04): the bar itself only shows the 5 "still moving" stages
  (Enquiry→Received) as a clean left-to-right progress reading; `Cancelled`/`In-Stock` render as
  small `✕ N cancelled` / `◈ N in-stock` chips below the bar instead of inline segments — a
  cancelled item isn't pipeline progress, mirroring how Operations' `ProcurementFlow` already
  treats Cancelled as a separate branch, not part of the main spine.
- **`lib/bom-fields.mjs`** gained `ACTIVE_STAGES`/`EXIT_STAGES`/`STAGE_BAR_COLORS`/
  `bomStageCounts()` — the last a pure reducer (null/unrecognized status folds into
  `DEFAULT_PURCHASE_STATUS`) shared by both placements and the self-check, so the numbers can
  never drift between surfaces.
- **Placement (client-confirmed): both** the **project page's Procurement queue**
  (`ProcurementQueue.jsx` — replaced the old 3-tile Sourcing/PO-placed/In-transit stat grid with
  `<BomStageBar size="full">` + a one-line `{total} items · {open} moving` summary + the legend;
  the client-side `bomStageCounts(bom)` reuses the same full-project `bom` prop already passed
  down, no new query) **and** the **Operations Master BOM card** (`app/page.js` — replaced the old
  2-segment closed/transit bar with `<BomStageBar size="compact">` per project row + one shared
  legend at the card footer).
- **`getBomWork()`** (`lib/data.js`) reshaped from a flat closed/transit/pending aggregate to a
  `GROUP BY (project, status)` query (same shape `getBomRollup` already used) reduced into a
  per-project `stages` object — its sole consumer is the Master BOM card, so this was free to
  change; the existing "BOM not uploaded" / open-items-only visibility filter is unchanged.
- **`ProcurementFlow.jsx` (Operations' pipeline diagram) pulled into the same visual system**, same
  day, on request — first pass was color-only (a restrained per-node tone, respecting an earlier
  round's "should be black and same as others" feedback). Live user review of that pass surfaced
  four real gaps, all fixed in a second pass:
  - **Stage vocabulary didn't match D4.** The diagram's old buckets (Sourcing/Selection/PO issued/
    Closed) were coarser than the real enum. Rewritten to the actual 6 stages (Requests/Enquiry/
    Comparison/Ordered/Transit/Received), generalized layout (`nodeX` computed from `STAGES.length`
    instead of a hand-maintained position dict) so this and `BomStageBar`/the Milestone Tracker now
    share one vocabulary, not just one color language.
  - **A real rendering bug, not a design choice: the branch connectors visually overlapped the
    boxes.** Root-caused via `getCTM()` in a live browser session — the connector `<svg
    viewBox="0 0 100 32" preserveAspectRatio="none">` gets stretched ~11.8x horizontally vs 1x
    vertically at typical widths, and SVG stroke width scales with that transform: a nominal
    `strokeWidth="1.5"` on a *vertical* segment was rendering at **~17.8px**, a solid block sitting
    on the box edges instead of a thin line. Fixed with `vectorEffect="non-scaling-stroke"` on every
    path — the standard fix, keeps stroke width constant regardless of the surrounding non-uniform
    scale. Confirmed after the fix via the same `getCTM()`-based measurement plus a visual re-check.
  - **This same stroke bug was most of "why Cancelled reads thicker than the rest"** — the fat
    vertical bar landed right above/adjacent to it. The remaining piece: the first color pass had
    tinted Cancelled's *value number* red too, on top of its existing faint wash; reverted the
    number back to neutral (`text-foreground`, matching every other node) so only the label word +
    wash + info-icon carry the signal — the exact restraint the original feedback asked for, now
    actually applied consistently instead of partially reversed.
  - **New: per-source Cancelled breakdown + an In-Stock box**, both real gaps, not polish.
    `getProcurementFlowCounts()` (`lib/data.js`) gained `deriveActiveStage`/`deriveCancelledOrigin`
    — cancelling never clears `po_ref`/`selected_quote_id`/the logged quotes (accept-cancellations
    and the manual override only flip `purchase_status`), so those same signals reconstruct which
    D4 stage a cancelled item was really at, now surfaced as small red count badges on each of the
    4 incoming connector lines (only rendered when non-zero). Also fixed a related bug caught in the
    same pass: `purchase_status` is **not kept live** by quote-logging or supplier-selection — only
    PO issue/unissue, cancel, and a manual override actually move it — so bucketing straight off the
    raw column undercounted `Ordered` (a selected-but-not-yet-issued item stayed reading "Enquiry").
    Both derive functions upgrade a stale/default status using the same signals the Phase 5.0
    backfill already used, matching this codebase's existing "signal-based inference, not exact
    tracking" precedent (SYSTEM.md §5a). `counts.in_stock` split out from the old combined
    `closed` bucket and given its own always-present box (0 until Group 6 ships fulfil-from-stock,
    with a tooltip saying so) — no data/UI silently hid a whole D4 terminal state anymore.

**Doesn't spoil anything:** one new component, one data-layer reshape whose only consumer is the
card it feeds, and one dead-code cleanup (`ProcurementQueue.jsx`'s old `Stat` component and its
now-superseded local status-bucketing consts, added in 5.0's sweep and removed here rather than
left to rot). A production build compiled clean.

**Verified (2026-08-04, live, real Turso dev DB):**
- `node lib/pmb-selfcheck.mjs` — new `bomStageCounts` asserts pass alongside the existing PMB
  parser asserts (a `null` and a stale pre-D4 token both fold into Enquiry, every other status
  counted exactly).
- `npm run build` clean; `rm -rf .next` (SYSTEM.md §20 guard) before and after dev-server use.
- UI walkthrough as `procurement_head` against the live reseeded demo (each of the 4 projects
  carries the full D4 spread): the project-page Procurement queue shows "9 items · 6 moving," the
  full-width stage bar (gray/blue/blue/amber/green segments proportioned correctly), "✕ 1
  cancelled," and the shared legend — the cancel-requests block underneath is unchanged and still
  works. Operations' Master BOM card shows the same bar (compact size) per project row with its
  own "✕ 1 cancelled" line, one legend at the card footer.
- Dark mode (`resize_window` + the app's own theme toggle, since the theme is a manual
  `[data-theme]` switch per SYSTEM.md §18, not driven by `prefers-color-scheme`): both placements
  re-render with fully legible, correctly adapted colors — confirmed via screenshot on both the
  project page and Operations.
- Zero console errors on a clean browser tab (an earlier tab's leftover HMR-recovery log noise
  from mid-restart navigation was investigated and ruled out — a fresh tab against the same
  running server showed no errors at all, and the rendered content was correct throughout).
- `ProcurementFlow.jsx` (second pass, real D4 stages + bug fixes): live demo data cross-checked
  against a direct DB query — Enquiry 8, Comparison 8, Ordered 4, Transit 4, Received 8 (matches
  the seed's per-project item template × 4 projects), Cancelled 4 with its badge correctly reading
  "4 cancelled from Enquiry" (the seeded Cancelled item — MS CHEQUERED SHEET — has no po_ref/quotes,
  so Enquiry-origin is the right answer), In-Stock 0. Caught and fixed the dropped
  `selected_quote_id` signal live (Ordered initially showed 0 despite 4 items having a selected
  supplier on a draft PO) before considering this done. Confirmed via `getCTM()` that the connector
  stroke renders at the real 1.5px in both dimensions post-fix (was ~17.8px on verticals pre-fix).
  Verified in both light and dark mode (app's own theme toggle) — all 8 nodes (6 spine + In-Stock +
  Cancelled), correct restrained tones, no overlap, badge visible and positioned cleanly below its
  source column. Zero console errors.
- **Third pass, same day: a real "boxes read as touching the lines" report from live use.**
  Investigated with `elementFromPoint()` at the exact pixel where the top spine line crosses each
  box's center — confirmed z-stacking was already correct everywhere (the box, not the line, was
  the hit-tested element at all 6 points) — so this wasn't a z-index bug. The actual cause: box rows
  and the connector strip sit at **zero gap** (`flex-col` with no `gap` class, box bottom and
  connector top at the exact same pixel) — nothing technically overlapped, but flush-touching with
  no whitespace reads visually as the line piercing the box border. Added `gap-2` to the row
  wrapper; confirmed via `getBoundingClientRect()` an explicit 8px gap now exists above and below
  the connector strip on both sides. Re-verified in light and dark mode — boxes now unambiguously
  float above the lines.

**Test 5.0b:** project page Procurement queue + Operations Master BOM card both show the per-stage
bar + legend with real per-project counts summing to each project's item total.

### Phase 5.1 — Enquiry tab (replaces Sourcing) + RFQ + portal + draft-send 🟢 built + live-verified 2026-08-04

**A real design gap found while scoping, resolved before building:** `purchase_status` was write-only
by two actions (PO issue → `Transit`, cancel/manual override) and otherwise purely *inferred* for
display (`deriveActiveStage`, Phase 5.0b) — logging a quote or selecting a supplier never touched it.
Decided this phase: **write it forward as part of the real actions that earn it.**
- Logging a quote (manual Add-quote **or** a supplier's first portal response) advances
  `Enquiry → Comparison`.
- Selecting a supplier stays **Comparison** — unchanged, it only starts a draft PO.
- **Issuing the PO now advances to `Ordered`** — a deliberate correction to the Phase 4 behavior,
  which jumped straight to `Transit`. D5's decision record ("Ordered pairs with Transit; matches
  PO-issued semantics") means PO-issued *is* Ordered; Transit is a later, real-world "shipment
  confirmed dispatched" moment reached only via the pre-existing manual Status-tab override — no new
  UI needed for that step. **Un-issue reverts symmetrically**, `Ordered → Comparison` (was
  `Transit → Ordered`).
- `lib/procurement.js`'s new `advancePurchaseStatus(bomItemId, target)` is the one shared, forward-
  only helper behind all of this — a small rank table (`Enquiry < Comparison < Ordered < Transit <
  Received`), never regresses an already-advanced status, never touches `Cancelled`/`In-Stock`.
  `ProcurementWorkspace.jsx`'s `OUT_OF_PIPELINE` (what drops out of Enquiry/Selection) gained
  `'Ordered'` alongside the existing `'Transit'` to match.

**Shipped:**
- **Enquiry replaces the Sourcing tab** (D1, `ProcurementWorkspace.jsx`) — same base query
  (`getSourcingItems`), same filtering, now with per-row checkboxes, a **select-all-from-search**
  header checkbox, and a bulk bar ("N selected · Create RFQ") once ≥1 item is checked. Manual
  **Add-quote is unchanged** in shape (append-only, D2) but now also calls `advancePurchaseStatus`.
  Items only in scope this phase (D3's PR entity has no create/read path until Phase 5.2) — Enquiry
  lists `bom_items`, `rfq_items.pr_item_id` stays unused.
- **Create RFQ** (`components/CreateRfqDialog.jsx`, `POST /api/rfqs`): confirm selected items → pick
  suppliers (searchable multi-select over the real 445-row Group 3 import, client-side filter, same
  pattern the Suppliers tab already uses) → mints `rfq_no` (`RFQ-<n>`, `nextCounterValue`), one
  `rfq_items` row per item, one `rfq_suppliers` row per supplier with a fresh
  `crypto.randomBytes(24).toString('hex')` token + 14-day `token_expires` (D12) → returns full detail
  in one response so the **draft preview** (D13) renders immediately: a composed message per supplier
  (fixed template — RFQ no./company, portal link, itemized list, 14-day validity line) with
  **WhatsApp** (`wa.me/<digits>`, India-only 10-digit→`91` prefix, disabled with a note if no phone),
  **Email** (`mailto:`, disabled if no email), and **Copy link** (always available, same
  `navigator.clipboard` idiom as `PeoplePanel.jsx`/`DevicesPanel.jsx`'s enroll-code copy). Clicking
  WhatsApp/Email fire-and-forget stamps that supplier's `sent_at` via `PATCH /api/rfqs/[id]`. No
  auto-send anywhere (D13/D19, unchanged).
- **Supplier portal** (`/rfq/[token]`, `app/rfq/[token]/page.js` + `components/RfqPortalForm.jsx`, no
  login, D12): per-item unit price/UoM/payment terms (`PaymentTermsField`, extracted to its own file
  so the public portal doesn't import the whole authenticated workspace bundle)/expected delivery/
  remarks → `POST /api/rfq/[token]` (public route, mirrors `POST /api/register`'s no-auth precedent)
  re-validates the token and its expiry **server-side** (never trusts the page having loaded before
  expiry — confirmed live, see below), inserts one `supplier_quotes` row per priced item
  (`quote_source: 'portal'`), stamps `rfq_suppliers.responded_at`, calls the same
  `advancePurchaseStatus`. One submission per RFQ (blocked client-side after success, matching the
  append-only precedent — a correction goes through Procurement, not a self-edit). `middleware.js`
  gained two prefix bypasses (`/rfq/`, `/api/rfq/` — singular, distinct segment from the authenticated
  `/api/rfqs`) alongside the existing `/api/agent` one.
- **Enquiry's quotes cell** now shows an RFQ badge even before any quote lands ("RFQ-1 · 0/2
  responded") — not just once ≥1 quote exists, a gap caught live while verifying (see below).
  Expanding a row with an active RFQ lazy-fetches `GET /api/rfqs/[id]` and lists each invited
  supplier's sent/responded state with a **Resend** button (D12 — reissues a fresh token, clears
  `sent_at`/`responded_at`) for anyone who hasn't responded yet.
- `lib/data.js` gained `getRfqByToken` (shared by the page and the public API route, so the two can't
  read the token differently), `getRfqSummaryByItem` (one query, "N/M responded" for the whole tab),
  `getRfqDetail` (full RFQ detail for the resend view and `GET /api/rfqs/[id]`).

**Doesn't spoil anything:** additive tables (already existed from Phase 5.0) + new routes/components;
the one behavior change (PO issue → Ordered, not Transit) is the explicitly-decided correction above,
not a regression — Status tab's manual override, PO cancel, and the accept-cancellations flow are all
untouched.

**Three real things found and fixed while building/verifying, not just the happy path:**
1. **`advancePurchaseStatus` initially had a live bug that would have silently resurrected cancelled
   items.** The forward-only guard checked `currentRank != null` to mean "already progressed, don't
   touch" — but `Cancelled`/`In-Stock` aren't in the rank table at all, so their rank is `undefined`,
   which is also `== null`, so the guard fell through and let a stray quote-log or portal-submit
   overwrite a cancelled item back to `Comparison`. Caught by
   `scripts/advance-status-selfcheck.mjs` (in-memory libsql fixtures, same precedent as
   `backfill-5.0-selfcheck.mjs` — `lib/procurement.js` is an ESM-syntax `.js`, only loadable through
   Next's bundler, so the self-check reimplements the same small rank logic rather than importing it,
   same reasoning as `bom-fields.mjs` being a `.mjs`) *before* it ever ran against real data — fixed by
   distinguishing "never set" (`purchase_status IS NULL`) from "set to something unranked" (any
   non-null status missing from `STATUS_RANK`) and refusing to touch the latter either way.
2. **A real RSC serialization warning**, not present anywhere else in the app: passing
   `getRfqByToken`'s result straight from the server-rendered `app/rfq/[token]/page.js` into the
   client-rendered `RfqPortalForm` triggered React's "only plain objects can be passed to Client
   Components" warning — libsql's row objects are Proxy-backed, not plain, and this is the first
   server→client prop path in the app that nests one Row's fields inside another (the `items` array
   inside the `rfq_suppliers` row) rather than reading rows API-side through a JSON boundary. Fixed by
   spreading every row into a real plain object (`{ ...rs, items: items.map(it => ({ ...it })) }`)
   before returning from `getRfqByToken`.
3. **The Enquiry quotes badge was invisible until a quote existed**, hiding the entire point of D13's
   tracking ("did this even get sent, has anyone answered") for the common in-between state. Fixed to
   render the badge on `quotes.length > 0 || rfqSummary` instead of `quotes.length > 0` alone.

**One real data gap found, not a code bug — flagged for the business, not fixed here:** all 445
imported real suppliers (Group 3) have `phone: null, email: null` — the vendor master file's contact
columns are empty (`lib/master-import.mjs`'s header mapping is correct and already covers `phone no.`/
`email id`; the source data simply has nothing in those columns for the rows checked). WhatsApp/Email
correctly disable per-supplier exactly as designed, but **no supplier in the real data can use either
channel today** — Copy link is the only working send path until contact info is added to the master
data, same "flagged, not guessed" precedent as the GST/STF-phone gaps in earlier rounds.

**Live-verified end-to-end, 2026-08-04** (dev server, real Turso dev DB, real session as
`procurement_head`, real 445-supplier data — not just the self-check):
- `node scripts/advance-status-selfcheck.mjs` — forward moves happen, same-rank is a no-op,
  `Ordered`/`Comparison` never regress from a later call, `Cancelled`/`In-Stock` are never touched
  either as the current status or as a requested target (the exact case that caught bug #1 above).
- `npm run build` clean; `rm -rf .next` (SYSTEM.md §20 guard) before and after dev-server use — hit
  the documented `.next`-corruption `useContext of null` gotcha once mid-session (build + dev in one
  tree), fixed by the prescribed `rm -rf .next` + restart, unrelated to any app code.
- Full real walkthrough: selected an item on Enquiry → Create RFQ → searched "ACE" over the real 445
  suppliers → picked 2 → RFQ-1 created → draft preview rendered the correct composed message + portal
  link per supplier, both WhatsApp/Email correctly disabled (no contact data) → Copy link worked
  (toast confirmed) → closed → Enquiry showed "RFQ-1 · 0/2 responded".
- Opened the real portal token (cookie-free — verified via a bare `curl` with no session cookie that
  the page renders with no `<nav>` at all, since the tab's own browser session shared an httpOnly
  `token` cookie that JS couldn't clear to simulate a true anonymous visit) → submitted a quote →
  success state → confirmed server-side: `responded_at` stamped, `supplier_quotes` row present
  (`quote_source: 'portal'`), item's `purchase_status` advanced to `Comparison`.
- Enquiry badge updated to "1 quote · 1/2 responded"; expanding the row showed the logged quote and
  the RFQ suppliers list (Responded / Not sent + Resend); clicked **Resend** on the un-responded
  supplier and confirmed via the API that its token/`token_expires` changed while the other supplier's
  stayed put.
- Selection showed the new quote, correctly labeled Lowest price; **Select** auto-drafted PO
  `599/SB/2026-27` (unchanged mechanism) with the item still at `Comparison`. **Issue** advanced the
  item to **`Ordered`** (confirmed on the Status tab — not `Transit`) and it dropped out of both
  Enquiry ("16" → "15" items) and Selection. **Cancel Issue** reverted it to **`Comparison`** and it
  reappeared in Selection, still showing the same selected supplier.
- Unknown token → "Link not found" page. Expired token (backdated `token_expires` via a direct DB
  write, since there's no fast-forward affordance in the UI) → "Link expired" page; confirmed the
  *API* also re-checks and 410s on an expired token via a bare `curl POST` (not just the page-level
  check) — the "never trust the page having loaded before expiry" requirement, actually exercised.
- Zero new console/server errors throughout — the only console warnings seen are the same pre-existing
  Radix `DialogOverlay`/`SheetOverlay` ref-forwarding warning already documented as systemic to the
  shared UI primitives in earlier phases (5.0b, Group 1/2), not anything in this phase's code.
- All test data (the RFQ, its quote, the draft/issued/unissued PO, the item's `purchase_status`/
  `po_ref`) cleaned up afterward via direct DB script — confirmed Enquiry back to "Select all (16)"
  with the test item showing no badge, matching its pre-test state exactly.

**Test 5.1:** select items → create RFQ → review draft → confirm wa.me + email fire → open a portal
token in a private window → submit a quote → it appears on Enquiry + in Selection. Selection's
existing manual pick + auto-draft-PO still works.

### Bundle A — Phase 5.2 (PR, unified) + Phase 5.3 (PO editing) 🟢 built + live-verified 2026-08-05

**Client decision that reshaped 5.2:** unify the old single-item "Request procurement" (Eng/Design
raise → Procurement accepts → materializes) with the new multi-item PR — no more accept gate. A PR
is now 1-or-more item lines, each split across 1-or-more projects with its own qty, and it
**materializes straight to `bom_items` on Enquiry the moment it's submitted**, timestamped. This
absorbs the "new-item" half of the original Phase 5.5 (the acceptance-gate flow is retired now,
not later) — only the **cancel**-request half of 5.5 remains, deferred to Bundle B with Phase 5.4.

**Shipped — 5.2 (PR, unified):**
- **New `/pr` page** (`app/pr/page.js` + `components/PrWorkspace.jsx`), one shared surface for
  Engineering/Design/Stores (a new "Requests" nav tab, gated the same way `inProcurement` already
  gates Procurement's — mutually exclusive with it so a dual-department head never sees two tabs
  both called "Requests"). Add/remove item lines; each line gets a description (see catalog picker
  below), optional MOC/size, and one-or-more `{project, qty}` splits.
- **Item Master catalog picker** (`GET /api/items?search=`, new — Group 3 imported the 2,773-row
  catalog but never built a query route). Search-as-you-type over `item_code`/`item_name`, picking a
  match autofills description/spec/UoM; typing straight through with no match is just free text —
  the deliberately lean fallback the client asked for ("if they don't like it, we can make changes
  later"). **Live-verified against real data the table doesn't have yet**: the `items` table in the
  dev DB is empty (Group 3's note that the item import was never actually run, no UI existed to
  trigger it) — confirmed via the search returning `[]`, then verified the free-text fallback path
  works end to end regardless.
- **`POST /api/purchase-requisitions`** — one `purchase_requisitions` header + one `pr_items` row per
  line + one `pr_item_projects` row per (line × project) + one materialized `bom_items` row per split,
  `purchase_status='Enquiry'`, tagged via a new `bom_items.pr_item_id` column (`addColumn()`). No
  intermediate acceptance step. **RFQ creation needed zero new code** — a PR-sourced item is a plain
  `bom_items` row from Enquiry's point of view, so `Create RFQ` (Phase 5.1) already handles it.
- **Retired the old single-item flow**: `request_item` removed from `TicketsPanel.jsx`'s Raise-dialog
  `kind` options; the "New-item requests" card removed from `RequestsWorkspace.jsx`/
  `app/requests/page.js` (Cancel requests card untouched — Bundle B's job). `procurement_requests`
  table + its accept/reject route left in place but dead, same "don't drop, mark unused" precedent as
  the old `tickets` table.

**Shipped — 5.3 (PO editing, draft-only per D11):** an issued PO is a real document with the
supplier already; editing is draft-only, Cancel Issue gets you back to draft first (existing 5.1
action, unchanged). New `PATCH /api/purchase-orders/[id]` actions:
- **`edit_item`** — updates the `po_items` qty/rate snapshot directly, propagates to
  `bom_items.qty_text` (e.g. `"6 Kg"`); the `supplier_quotes` log stays untouched (append-only,
  unchanged).
- **`change_supplier`** — pick an already-logged quote or add a brand-new supplier's quote inline.
  Extracted the select-supplier route's re-point/tri-state/draft-PO logic into a shared
  `lib/procurement.js` helper, `selectQuoteForItem()`, so this and the original
  `POST /api/bom-items/[id]/select-supplier` can't drift apart.
- UI: an **Edit** button on the PO drawer (draft-only), opening a small `EditPoLinesDialog` stacked
  on top of the existing PDF preview (that component is shared with QC/packing PDFs and has no
  generic content slot, so editing lives in its own dialog rather than being squeezed in).

**One real bug found and fixed live:** moving a PO's *last* line to a different supplier deletes the
now-empty draft PO (existing `removeItemFromDraftPO` behavior, correct) — but the edit dialog's
"refresh after save" blindly re-fetched that same now-gone PO and threw an unhandled 404, surfacing
as a raw error toast instead of the success state. Fixed by catching that specific case and closing
both the line-editor dialog and the PO drawer (`onPoGone`) instead of trying to refresh a PO that no
longer exists. Re-verified: a full "move the only line to a new supplier" pass now shows a clean
"Supplier changed" toast, both dialogs close, and the Active PO count reconciles correctly — no
error, no stale drawer.

**Doesn't spoil anything:** one additive column (`bom_items.pr_item_id`), two new routes
(`/api/purchase-requisitions`, `/api/items`) + one extended route (`/api/purchase-orders/[id]` PATCH)
+ one new small route (`/api/bom-items/[id]/quotes`, exposing the already-existing `getItemQuotes`),
one new nav tab gated to departments that didn't have one, one dead-but-present table. A production
build compiled clean throughout.

**Live-verified end-to-end, 2026-08-05** (dev server, real session, real Turso dev DB):
- Raised a PR as `engg_head`: one line via free text (catalog empty, confirmed above), spanning
  SB-1103 (3 Nos) and SB-1104 (2 Nos) — both `bom_items` rows appeared on Enquiry **immediately**, no
  accept step, tagged `PR-1 · 04 Aug 2026`, correct qty per project.
  confirmed via direct DB read: `qty_text` "3 Nos" / "2 Nos" on the two rows.
- Confirmed `TicketsPanel`'s Raise dialog (as `design_head`) no longer offers "Request procurement"
  in its Kind dropdown — only Task / Send back / Cancel BOM item remain — and `/requests` shows only
  the Cancel requests card.
- PO editing: selected a supplier for MS ANGLE (SB-1103) → draft PO 600/SB/2026-27 → Edit → qty 4→6
  → total recalculated ₹274→₹411 → confirmed `bom_items.qty_text` became `"6 Kg"`. Change supplier →
  picked a second logged quote → confirmed (see bug above) it re-points cleanly and reconciles the
  draft PO list; repeated on a fresh item (SB-1104) to confirm the fix, clean "Supplier changed"
  toast, no error.
- `npm run build` clean, `rm -rf .next` (SYSTEM.md §20 guard) before/after dev-server use. No console
  errors throughout.

**Test 5.2/5.3 (superseded by the above, kept for the original spec's intent):** create a PR
spanning two projects with a qty split → items land on Enquiry immediately → edit a draft PO's
price/qty → change its supplier → confirm Enquiry/Selection/PDF all reflect it.

### Bundle B — Phase 5.4 (Cancellation, D10) + Phase 5.5 remainder (retire cancel-request card) 🟢 built + live-verified 2026-08-05

**Where Eng/Design trigger it, resolved while building:** a direct **Cancel** icon on the BOM row
itself (`components/BomTable.jsx`), not the Raise dialog — consistent with how Bundle A's PR flow
also lives outside `TicketsPanel.jsx` (that dialog is incidents-only). Shown only when the row's
status is still cancellable; hidden entirely once Transit+, so the constraint reads from the UI
before it ever reaches the server.

**Shipped:**
- **`POST /api/bom-items/[id]/cancel`** — Engineering or Design only. Cancellable set is
  `{Enquiry, Comparison, Ordered}` (D10 — a stricter set than `OPEN_STATUSES`, which still counts
  Transit as open; a separate `CANCELLABLE` constant, not a reuse, since the two sets diverge on
  purpose). Sets `purchase_status = 'Cancelled'`, cleans up any live draft-PO line via the existing
  `removeItemFromDraftPO` (an item can be `Comparison` with a supplier selected and a draft PO
  already started — that line shouldn't survive a cancel). **Ordered-stage cancel notifies
  Procurement** (`notifyDepartment`, existing helper, `kind: 'po_void_needed'`) — Ordered means a PO
  was actually issued (Phase 5.1's `advancePurchaseStatus`), a real external document Procurement
  has to void with the supplier, not something this route can do for them. `po_ref` is deliberately
  left in place on cancel (not cleared) — the historical record `ProcurementFlow.jsx`'s
  `deriveCancelledOrigin` already relies on to show "cancelled from Ordered/Transit."
- **Design gained BOM visibility for the first time** — `components/DepartmentPanel.jsx`'s
  `BOM_DEPARTMENTS` (the generic read-only `BomTable` card, previously `['Stores', 'Production']`)
  now includes `'Design'`. Design has no `BOM_FIELD_OWNERS` entry, so `editableBomFields(user)`
  already returns `[]` for them via existing generic logic — zero new server-side wiring needed,
  they get a fully read-only table plus the new Cancel action. `BomTable.jsx` gained a `canCancel`
  prop (independent of `editableFields`, since Design has none) and a `hasActions` derivation so the
  Actions column renders for Design even though `dialogFields` is empty.
- **Retired the old cancel-request mechanism**: `cancel_item` removed from `TicketsPanel.jsx`'s
  Raise-dialog `kind` options (mirrors Bundle A's `request_item` removal — the two retirements are
  now symmetric). The Cancel-requests card removed from `ProcurementQueue.jsx` (project-page
  Procurement view) and from the **Requests tab**, which — with both its cards now gone (New-item in
  Bundle A, Cancel-requests here) — is retired entirely: `app/requests/page.js`,
  `components/RequestsWorkspace.jsx` deleted, its Nav link removed. `tasks.bom_item_id` +
  `POST /api/production/tasks/accept-cancellations` left in place but dead, same "don't drop, mark
  unused" precedent as `procurement_requests` in Bundle A.

**One real bug found and fixed, unrelated to Group 5 but caught while verifying it on the
newly-added Design BOM view:** `BomTable.jsx`'s section-divider rows keyed purely on section name
(`s-${section}`) — a BOM whose sections repeat non-contiguously (BOILER → BOM → MOUNTINGS → BOILER
again, the real shape of SB-1103's seed data) produced duplicate React keys, a live "two children
with the same key" console warning. Pre-existing (confirmed via `git diff` — Engineering's identical
table has carried this since before Group 5), just never surfaced because nothing before this session
had verified against a BOM with a repeating section pattern on a second department's read of the same
table. Fixed by keying on `${section}-${b.id}` (the group divider below it already did this
correctly) — cheap, in a file already open this session, no behavior change.

**Doesn't spoil anything:** one new route, one additive UI affordance gated by department + status,
one new department added to an existing generic BOM-visibility list, two dead-but-present routes/
tables, one page deleted (fully superseded, not partially). A production build compiled clean.

**Live-verified end-to-end, 2026-08-05** (dev server, real sessions, real Turso dev DB):
- As `design_head`: the project page now shows a read-only **"Master BOM — Design"** card; rows at
  Enquiry/Comparison show a Cancel (⊗) icon, the Transit row (FEED PUMP) correctly has **no** icon at
  all — the client-side gate matches the server's.
- Cancelled a `Comparison`-stage item (MS ANGLE, with a live draft-PO line on ANITA STEEL AND METALS)
  via the real route: `purchase_status` → `Cancelled`, and its `po_items` line was gone — the
  draft-PO cleanup fired correctly.
- Cancelled a `Transit`-stage item (FEED PUMP) → clean 400, `"Can't cancel — already Transit"`.
- Built a real Ordered-stage scenario end to end (select a supplier as `procurement_head`, issue the
  PO — item advances to `Ordered` per Phase 5.1) → cancelled it as `design_head` → confirmed
  `purchase_status` flipped to `Cancelled`, **`po_ref` preserved** (596/SB/2026-27, not cleared), and
  a real `notifications` row landed for the Procurement head: `kind: 'po_void_needed'`, title
  `"Void PO — GLOBE VALVE (MSSV) - F/E"`, body correctly naming the PO number and who cancelled it.
- Confirmed `/requests` now 404s (route fully removed) and the bottom nav's old "Requests" tab is
  gone for `procurement_head` — only Bundle A's `/pr` tab keeps that label, for Eng/Design/Stores.
- Confirmed `TicketsPanel`'s Raise dialog (as `design_head`, "To department: Procurement") no longer
  offers "Cancel BOM item" in its Kind dropdown — only Task / Send back (rework) remain.
- Full console sweep: the only warnings present were the pre-existing, already-documented Radix
  Dialog ref-forwarding quirk (same systemic issue noted repeatedly elsewhere in this codebase, not a
  regression) and the duplicate-key warning above, fixed live before considering this done. No other
  console/server errors. `npm run build` clean, `rm -rf .next` (SYSTEM.md §20 guard) before/after
  dev-server use — one `.next`-corruption `useContext of null` recurrence mid-session, same known
  gotcha, same fix.

**Test 5.4/5.5:** cancel an Ordered item → Procurement notified, item `Cancelled` → try to cancel a
Transit item → blocked → confirm the old cancel-request card/flow no longer appears once retired.

### Post-Group-5 sweep (pre-demo audit, 2026-08-05)
Code-level audit after Group 5 closed: no dangling references to any retired mechanism, all three
self-checks pass, production build clean. **`scripts/seed-procurement-demo.mjs` was still seeding
pre-Group-5 reality and got aligned:** its wipe now also clears the RFQ/PR tables (FK order matters
— `rfq_items` references `bom_items`, so RFQs clear before the BOM wipe; `bom_items.pr_item_id`
references `pr_items`, so PR tables clear after it) and `po_void_needed` notifications; it no longer
seeds pending new-item requests or cancel-request tasks (retired mechanisms — the rows would be
invisible and unresolvable); every item now gets an explicit D4 status matching the 5.1
write-forward model (quoted → `Comparison`, issued PO → `Ordered`, with 2 of 4 projects' Feed Pumps
overridden to `Transit` so the demo shows every stage without faking how any is reached — the old
seed left 20 rows NULL and stamped issue as `Transit`, both pre-5.1 semantics that would have read
wrong on the Status tab); and selection now writes the D2 `is_selected` tri-state. Reseeded live:
36 items — Enquiry 8 · Comparison 12 · Ordered 2 · Transit 2 · Received 8 · Cancelled 4, zero NULL
statuses, tri-state 8/4/12 (winner/rejected/undecided). All Bundle A/B verification residue (test
PRs, mutated items, orphaned notifications) wiped by the same reseed.

---

## Group 6 — Sales dept + Stores inventory + In-Stock + SAS trading ✅ (phased)

Client points 3 & 4 — now specified. Depends on Group 5's foundation (`inventory_items`, `source`,
`sale_order_no`). Ships in **4 phases**.

### Phase 6.1 — Sales department (generic v1)
- New **Sales department** — copy a department's **Home** as the shell (SYSTEM.md §3a pattern). **Not
  tied to current projects.** Sales maintains a simple list of **Sale Order numbers** (D14, free
  text) that Stores/Procurement reference for trade items.

**Test 6.1:** log in as a Sales head → Home renders → create a Sale Order number → it's referenceable.

### Phase 6.2 — Stores inventory management
- Stores manages **`inventory_items`** (D8): view/adjust on-hand, location, reorder point. Reorder-
  point flag surfaces low stock.

**Test 6.2:** Stores adds an inventory item, sets on-hand, sees a low-stock flag when below reorder.

### Phase 6.3 — In-Stock fulfilment + stock-building
- **Fulfil from stock (D6/D9):** marking a requested item **In-Stock** (terminal status) **decrements
  `inventory_items` on-hand** with a Stores confirm step — item never enters procurement.
- **Build stock (D7):** a `source='stock'` item runs the full Enquiry→Received pipeline; on
  **Received it increments** `inventory_items` (instead of a project BOM). `project_id` optional for
  these.

**Test 6.3:** request an item that's in stock → mark In-Stock → on-hand decrements → procure a
`stock` item → on Received, on-hand increments.

### Phase 6.4 — SAS / trade + non-BOM procurement requests
- Stores can **request procurement for non-BOM things**, tagged **`source='bom'` + project_id**
  (project need) or **`source='sas'` + `sale_order_no`** (trade). `sas` items run normal procurement;
  on Received they land as trade stock / against the Sale Order.

**Test 6.4:** Stores raises a `sas` request with a Sale Order no → it flows through Enquiry→Received →
lands against the SO, no project required.

---

## Still needed from you

**Nothing outstanding for Groups 0–3 — all resolved and built.** Shanti Techno Fab's identity,
phone, doc-ID prefix, and letterhead were all resolved 2026-08-04 (see Group 2); the Directorate-
header question turned out not to apply to Form IV A at all. One open nice-to-have, not blocking:

1. **STF phone number**, if/when available — one-line edit to `COMPANY_PROFILES` in
   `lib/qc-doc-pdf.js`, currently omitted rather than guessed.
2. **Master data — suppliers live.** Vendor (445), Customer (332), and Item Master — Purchase (2,773)
   Excels all supplied and parsed 2026-08-04 (Group 3). **Vendors are imported and live** in the real
   Turso dev DB (445 rows, verified via `GET /api/suppliers`). Customer/item imports use the same
   route/parser but have no UI surface yet to trigger from (Sales dept / item-catalog screen don't
   exist) — run the same way once those land, or sooner via a direct API call if wanted.
3. **R2 bucket values** (Group 0): env **names are locked**; the 5 values arrive later and don't
   block coding. Mail transport is **deferred** (D19) — nothing needed there for now.
4. **AI extraction env — locked:** `OPENROUTER_API_KEY`, `EXTRACTION_MODEL=google/gemini-2.5-flash`.

---

## Deferred / discuss-later, not lost

- Redefining how **QC sees Home / Operations / Projects / QC** (client point 1 opener). Parked.
- The general **Operations/project-page redesign** for departments other than Procurement (SYSTEM.md
  §8). Group 4's card move touches only Procurement's Operations view.
- The generic `TicketsPanel` default-title cleanup (SYSTEM.md §8) — separate from the D15 rename.

---

## Build discipline

- **Order:** **seed reset (D18)** → 0 → 1 → 2 → 3 → 4 → 5.0…5.5 → 6.1…6.4. One commit + one
  verification per group/phase (the Round-1 procurement precedent: "each phase verified live and
  committed separately"). The seed reset (`scripts/reset-demo.mjs`: wipe + one minimal synthetic
  project) lands first so every later phase verifies against clean, obviously-fake data.
- **Never regress SYSTEM.md behavior.** Every schema change is `addColumn()`/new-table with a safe
  default and (for the D4 enum) an idempotent backfill; every PDF change preserves the existing
  default output; every nav/card move keeps the old gate.
- **Stick to this list.** New ideas surfacing mid-build get appended here as open questions, not
  built on the spot.
