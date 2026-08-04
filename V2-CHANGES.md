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
a real byte-level PDF comparison between both companies. **Groups 4–6 remain unstarted.**

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
| **5** | Procurement data model + RFQ/Enquiry + PR + PO editing + cancellation | ✅ READY (phased) | Group 3 ⛓ |
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

### Phase 5.0 — Data-model foundation (schema only, no UI)
The interdependent migration all later phases build on. All additive, all `addColumn()` / new tables.
- **`purchase_status` enum → D4** (`Enquiry/Comparison/Ordered/Transit/Received/Cancelled/In-Stock`).
  **Backfill existing rows** (demo data is reseedable, low risk): `TRANSIT→Transit`,
  `CLOSED→Received`, `RECEIVED→Received`, `CANCELLED→Cancelled`; `PENDING` splits by existing signal
  — has `po_ref`→`Ordered`, else has ≥1 quote→`Comparison`, else→`Enquiry`. One-off backfill in
  `migrate()`, idempotent.
- **`bom_items.source`** → D7 (`bom` default / `stock` / `sas`) + **`bom_items.sale_order_no`** (D14,
  free text, for `sas`). Relax the app-level "project_id required" expectation for `stock`/`sas` only
  (column stays as-is on `bom_items`; PR items carry the multi-project split, see below).
- **`supplier_quotes.is_selected`** → D2 (tri-state, nullable).
- **`purchase_requisitions`** (header: id, pr_no, raised_by dept, created_at, awarded_supplier_id
  null) + **`pr_items`** (pr_id, bom description/spec, total qty, and a **per-project qty split** —
  either a child `pr_item_projects(pr_item_id, project_id, qty)` table or a JSON column; child table
  is cleaner for reconciliation) → D3.
- **`rfqs`** (id, rfq_no, created_at, status draft/sent/closed) + **`rfq_suppliers`** (rfq_id,
  supplier_id, **token**, token_expires (14d, D12), sent_at, responded_at) + link RFQ ↔ items.
- **`inventory_items`** (D8: id, description, spec, on_hand qty, location, reorder_point) — created
  here, used by Group 6.

**Test 5.0:** run `migrate()` on a copy → confirm every existing bom_item got a sensible new status,
`source='bom'`, and no row was lost; confirm new tables exist. Pure DB check, no UI.

### Phase 5.0b — Master BOM stage viz + legend (deferred here from Group 4c)
Built **right after 5.0** so it's authored once, on the final stage names — not the current
soon-to-be-renamed ones (the reason it was pulled out of Group 4; client-confirmed 2026-08-04). The
client's ask (point 2): "better master BOM visualization... which stage and how many remaining, in
project view... simple legends like the milestone tracker."
- **Placement (client-confirmed): both** the **project page's Procurement queue**
  (`ProcurementQueue.jsx` — per-project, the literal "project view"; today just 3 stats
  Sourcing/PO-placed/In-transit) **and** the **Operations Master BOM card** (`app/page.js` — per-
  project rows; today a 2-segment closed/transit/pending bar).
- Upgrade both to a per-project **stage breakdown bar** across the D4 stages
  (Enquiry/Comparison/Ordered/Transit/Received + Cancelled/In-Stock as terminal) **with a legend**
  mirroring the milestone tracker's (`PortfolioDelayTimeline.jsx`). Centralize the per-project bucket
  computation once (extend `getBomWork()` / a small helper shaped like `getProcurementFlowCounts()`
  but grouped by project) so both surfaces read the same numbers.

**Test 5.0b:** project page Procurement queue + Operations Master BOM card both show the per-stage
bar + legend with real per-project counts summing to each project's item total.

### Phase 5.1 — Enquiry tab (replaces Sourcing) + RFQ + portal + draft-send
- **Enquiry replaces the Sourcing tab** (D1). Table of items + PRs, search, **select-all-from-search**,
  status filter. **Keep manual Add-quote** here (append-only, D2). Selection/PO/Status/Suppliers tabs
  unchanged.
- **Create RFQ** from selected items/PRs → pick suppliers (searchable multi-select from Group 3's
  list) → **in-system draft preview** (D13: recipients + composed message + item list + each
  supplier's portal link) → review → **WhatsApp click-send (`wa.me`)** + an **Email button that
  shows the same draft** (D13/D19 — no auto-send yet; a `mailto:`/copy is the lazy stand-in).
- **Supplier portal** (`/rfq/[token]`, no login, 14-day expiry, D12): per-supplier item list with
  unit price / payment terms / expected delivery / remarks → submit writes `supplier_quotes` rows
  (stamps `rfq_suppliers.responded_at`). Quotes cell on Enquiry summarizes "N/M responded,"
  expandable.

**Test 5.1:** select items → create RFQ → review draft → confirm wa.me + email fire → open a portal
token in a private window → submit a quote → it appears on Enquiry + in Selection. Selection's
existing manual pick + auto-draft-PO still works.

### Phase 5.2 — PR bundles
- **Create a PR** (D3) from Design/Engineering: bundle items, **attach multiple project ids with
  qty-per-project split**, raise. An RFQ can be created from a PR just like from loose items. On
  award/receipt, each project's portion reconciles back per the stored split. **Tie-in:** the
  Engineering/Design request flow must carry the same multi-project attachment.

**Test 5.2:** create a PR spanning two projects with a qty split → create an RFQ from it → award →
confirm each project sees its portion.

### Phase 5.3 — PO editing (D11)
- Pencil icon in the PO table → **change supplier** (pick from other quoters, or add a brand-new
  supplier's quote inline → insert quote `is_selected=1`, re-point `selected_quote_id`, redraft PO),
  and **edit item qty/price** on the **`po_items` snapshot** (+ `bom_item` qty; quote log stays
  immutable). Edits propagate to Selection + Enquiry views.

**Test 5.3:** edit a PO's price (quote log unchanged, PDF reflects new price) → change its supplier
(new quote logged, selection re-pointed) → confirm Enquiry/Selection reflect it.

### Phase 5.4 — Cancellation (D10)
- Eng & Design cancel at **Enquiry/Comparison/Ordered**, **blocked at Transit+**. Ordered-stage
  cancel notifies Procurement to void the PO. Replaces today's cancel-request card mechanism.

**Test 5.4:** cancel an Ordered item → Procurement notified, item `Cancelled` → try to cancel a
Transit item → blocked.

### Phase 5.5 — Remove the Request-tab mechanism
- **Only after 5.1 is live** (so requests have somewhere to land): Engineering/Design/Stores requests
  show **directly on Enquiry** with an **arrival timestamp** (when it was requested), and Enquiry
  gets **sort + filters** (by timestamp, department, status, project) to manage large lists. Retire
  the **New-item requests** and **Cancel requests** cards. Don't delete the acceptance-gate data path
  until Enquiry demonstrably receives requests, or requests would have nowhere to go.

**Test 5.5:** raise a request from Engineering → it lands on Enquiry with a timestamp, no Requests-tab
card needed.

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
