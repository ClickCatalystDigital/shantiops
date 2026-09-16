# Stores Department — Authoritative Specification

**Status: AUDIT COMPLETE + ROUND 1 FIXES APPLIED.** This document describes the Stores department
**as it is actually implemented in the codebase today**, verified by reading the real source files
(not by re-reading old plan files, and not from memory of what was discussed in chat). Every claim
below carries a file/line citation. Where the implementation diverges from an earlier plan, or
where a different mechanism does the same job in two places, that is called out explicitly in §18
(Gaps) — now split into **Fixed this round** and **Still open**.

**How this was produced:** every table schema, every API route, every `lib/*.js` function, and
every relevant React component listed in §19 was read directly, in full or in the specific,
cited region, during the original audit. No claim here is inferred from a docstring, a plan file,
or a prior conversation summary alone — each was cross-checked against the real `CREATE TABLE`
statement, the real route handler, or the real component code. §20 states plainly what has and has
not been verified, updated after the round below.

**Round 1 fixes (applied after the original audit, no other architectural/UI change made):**
- **Gap #1 (Critical) — fixed.** `getChildRoutingBoard()` (§15, multi-unit split-order routing)
  now excludes a `(bom_item, child)` cell from `ready` whenever that line has a pending Inward QC
  Approval — the same guard already applied at the other four readiness sites (§3, §7, §8, §10).
- **Gap #3 — fixed.** `issueMaterial()`'s scalar floor-check/`on_hand` decrement (§12) no longer
  shares the accounting-only `totalCost > 0` gate — a never-costed line's stock now moves and is
  floor-checked exactly like a costed one; only the journal-entry posting stays cost-gated.
- **Gap #5 — investigated, confirmed correct as-is, not fixed.** `getOpenBomItems()`'s lack of a
  `pending_review` filter (§9) is the intended design, not an oversight — see §18 for the exact
  evidence.
- Verified: `npm run lint` clean; every real caller of both changed functions traced through
  (§18's "Fixed this round" entries carry the full trace). No browser/live-DB verification —
  same boundary as the original audit, see §20.

---

## 0. Master flow diagram — the full Stores lifecycle

```
                                    PROCUREMENT
                                        │
                          PO issued, RFQ split across
                          sibling/child projects (optional)
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  §1 RECEIVE A DELIVERY                                                       │
│  ReceiveBomItemDialog.jsx / BomGrnTab (bulk)                                 │
│  POST /api/bom-items/[id]/receive                                            │
│                                                                                │
│  qty + traceability (§2: heat/mtc/batch/serial, per bom_items.requires_*)    │
│  → bom_item_receipts row (ledger, always written)                            │
│  → bom_items.purchase_status = 'Received'   (only once cumulative qty        │
│    meets itemRollupQty() — partial receipts stay open)                       │
│  → inward_approvals row created  (ALWAYS — one per physical delivery)        │
└───────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  §3 INWARD QC APPROVAL GATE  (QC department, Head-gated)                     │
│  POST /api/inward-approvals/[id]/decide                                      │
│                                                                                │
│   pending ──approve──> releases held stock_pieces (pending_qc_inward→available)│
│      │                 + credits scalar on_hand + auto-reserves it           │
│      └──reject──> stock stays held; POST .../resubmit re-opens a new cycle   │
└───────────────────────────────────┬────────────────────────────────────────┘
                                     │ (only once approved)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  §4/§5/§6 INVENTORY CUSTODY                                                  │
│  lib/bom-receiving.js: maybeCreatePieceStock() / maybeReserveScalarStock()   │
│                                                                                │
│  catalog-linked + dimensional → real stock_pieces rows (owner_project_id)    │
│  catalog-linked + scalar      → inventory_items.on_hand credited + reserved  │
│  NOT catalog-linked           → stays a bare bom_items row, never touches    │
│                                  inventory_items at all                       │
└───────────────────────────────────┬────────────────────────────────────────┘
                                     │
              ┌──────────────────────┴──────────────────────┐
              │  (normal / sibling project — no children)    │  (split-master project — has children)
              ▼                                               ▼
┌──────────────────────────────┐              ┌───────────────────────────────────────┐
│ §7/§8/§16 ALLOCATE            │              │ §15 MULTI-UNIT ALLOCATION & ROUTING     │
│ AllocateTab (Stores UI)       │              │ AllocationPanel → ChildRoutingPanel     │
│ POST .../route-self           │              │ POST .../allocate  then  .../route-to   │
│                                │              │                                          │
│ Production ☐ / Dispatch ☐     │              │ qty split across N child units, then     │
│ (pre-filled from this line's  │              │ per-cell Production/Dispatch routing     │
│  own frozen requires_mfg,     │              │ (bom_item_child_routing, same table)     │
│  freely overridable)          │              │                                          │
│ "Default" ☑ corrects the      │              │ getChildRoutingBoard() = single source   │
│ CATALOG's future default,     │              │ of truth, consumed by BOTH batch routes  │
│ never this line               │              │ below                                    │
└──────────┬─────────────────┬──┘              └──────────┬──────────────────┬───────────┘
           │                 │                             │                  │
    routed_to=            routed_to=                routed_to=          routed_to=
    'production'          'dispatch'                'production'        'dispatch'
           │                 │                             │                  │
           ▼                 ▼                             ▼                  ▼
┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ §9/§10 MATERIAL     │  │ Dispatch's own        │  │ POST /api/job-    │  │ POST /api/packing/    │
│ DEMAND / worklist   │  │ readyForPacking        │  │ cards/batch-      │  │ batch-children         │
│ getPendingProduction│  │ (getProjectBom /      │  │ children           │  │                        │
│ MaterialLines()     │  │ getPendingPackingItems│  │ (job card per      │  │ (packing list per      │
│ → MaterialIndent-   │  │ / getDispatchWork —   │  │  routed+ready      │  │  routed+ready cell)    │
│  Worklist.jsx        │  │ 3 duplicated sites,   │  │  cell)             │  └──────────┬─────────────┘
│  (Production side)   │  │ all pending-inward-    │  └──────────┬─────────┘             │
└──────────┬───────────┘  │ gated)                 │             │                       ▼
           │               └──────────┬─────────────┘             │            §8 PACKING → PRE-DISPATCH
   POST /api/material-               ▼                             │            APPROVAL (QC + Production,
   indents (Production               packing/from-bom               │            both Head-gated) →
   raises)                            POST /api/packing/[id]/       │            dispatched, stock_pieces
           │                          submit-for-approval            │            → consumed, cost posted
           ▼                          (§8 pre-dispatch QC+Prod        │
  §11 STORES sees it in               approval gate, same as         │
  "Material Indents" tab              multi-unit path)                │
  (IndentsCard)                                                       │
           │                                                          │
           ▼                                                          ▼
  §12 STORES ISSUE                                          (job card execution —
  release/route.js or                                        outside Stores' scope)
  reserve-piece/route.js
  → material_issues row
           │
           ▼
  §13 ISSUED TO WIP
  MaterialIssuesCard
  GET /api/material-issues
```

Two structurally independent tracks run alongside all of the above and are documented separately
because they don't sit on this main line:

- **§14 Reservations** — `inventory_items`-level Reserve→Issue (`ActiveReservationsCard`), used both
  by the automatic matcher (`lib/remnant-match.js`, `lib/procurement.js`'s `autoReserveFromStock`)
  and by manual Stores action. This is what actually moves `on_hand` for a scalar catalog item; it
  runs whether or not the line ever reaches Allocate.
- **§6 Remnants** — Production's Cut action (`lib/stock-pieces.js`'s `cutPiece()`) creates new
  `pending_receipt` stock outside the receiving flow entirely; it re-enters the same custody model
  at `confirmPieceReceipt()`.

---

## 1. Receiving / Procurement → Receive Delivery

**UI → API → DB → state → next module**

```
components/ReceiveBomItemDialog.jsx (per-line, "Search" mode of Receive a Delivery)
components/StoresWorkspace.jsx :: BomGrnTab (multi-select, one shared receipt, "Bulk by project" mode)
        │
        ▼ POST /api/bom-items/[id]/receive   (app/api/bom-items/[id]/receive/route.js)
        │
        ├─ stock_receipts        INSERT (unless an existing receipt id is reused) — supplier_id,
        │                        grn_ref, invoice_no ALL required (no "speculative" receive here)
        ├─ bom_item_receipts     INSERT — always, one row per physical delivery event, even partial
        ├─ bom_items             UPDATE purchase_status='Received' — ONLY once cumulative
        │                        qty_received across every bom_item_receipts row for this line
        │                        meets itemRollupQty() (unit-count/assembly-multiplier aware)
        └─ inward_approvals      INSERT — ALWAYS, one per bom_item_receipts row, status='pending'
                                  (lib/bom-receiving.js :: creditBomItemReceipt(), line 47-88)
        │
        ▼ (best-effort, after the transaction commits)
        ├─ maybeCreatePieceStock()      — §4/§6, dimensional+catalog-linked lines only
        ├─ maybeReserveScalarStock()    — §4, scalar+catalog-linked lines only
        └─ notifyInwardApprovalPending() — notifies QC Heads
```

**Traceability object is shared across a whole delivery.** `heat_no`/`mtc_no`/`supplier_batch_no`/
`serial_no`/`test_certificate_id` are captured once per POST and applied identically to every
target in that submission (primary line + siblings) — genuinely correct, since it's one physical
delivery (`receive/route.js:139-147`).

**Partial receiving is real, not simulated.** Every call inserts a `bom_item_receipts` row
regardless of amount; `purchase_status` only flips once the cumulative total across every row for
that line meets the required quantity (`receive/route.js:211-233`, `t.isFullyReceived`). The
dialog's own qty field defaults to the *remaining* outstanding amount, not the original requirement
(`ReceiveBomItemDialog.jsx`, `GET` handler at `receive/route.js:49-74`).

**Sibling-split receiving.** When a PR line was split across several unrelated projects at raise
time (`bom_items.pr_item_id` shared), one physical delivery can credit several `bom_items` rows in
one submission via the optional `splits: [{bom_item_id, qty, routed_to}]` array
(`receive/route.js:149-233`). Eligibility (must share `pr_item_id`, must not already be terminal)
is re-validated server-side, never trusted from the client. The dialog **pre-selects** every known
sibling recipient at its own planned quantity (`ReceiveBomItemDialog.jsx`, the `useEffect` gated on
`status`, deduped onto the `siblingDefaultQty()` helper) — this was a gap found and fixed during
this session (siblings previously loaded but started unchecked).

**Master/child (multi-unit split) lot-labeling.** A separate mechanism — `bom_item_expected_children`
(Procurement's own PO-line lot references, `lib/db.js:3445-3453`) — lets Procurement declare which
child units a specific lot of a master-project PO line is destined for. When a line has more than
one declared lot, Receive requires picking which lot this delivery is (`lotLabel`,
`ReceiveBomItemDialog.jsx:76-77`). This is a plain reference (no quantity), **completely separate**
from the actual per-unit **Allocation** step described in §15 — declaring a lot doesn't allocate
anything; Stores still has to allocate the received quantity to specific children afterward.

**Two distinct receiving entry points on the same underlying dialog/route**, not two different
mechanisms:
- **Search** (`ReceiveDeliveryTab`, `StoresWorkspace.jsx:2096`) — cross-project search by material/
  project/PR/PO, one line at a time via `ReceiveBomItemDialog`.
- **Bulk by project** (`BomGrnTab`, `StoresWorkspace.jsx:2205`) — pick a project, multi-select
  several lines, one shared `ReceiptPicker` receipt applied to all of them in one action. Genuinely
  the only capability the search mode can't reproduce (one receipt across many lines at once).

**Guards, all server-side, not just UI-hidden:**
- Already `Received` → 409 (`receive/route.js:98-100`).
- `Cancelled` → 409, cannot be revived through this route (`receive/route.js:104-106`) — only a
  PM/admin editing `purchase_status` directly can undo that.
- A `receiptId` reused from the picker is re-validated for supplier/GRN/invoice even though it
  already exists — an old, pre-official-flow `stock_receipts` row (created via the speculative
  piece-receiving path, no invoice) cannot silently satisfy this flow's own requirements
  (`receive/route.js:118-127`).

**Downstream:** a fully-received line with no children lands in Allocate (§7/§8/§16); a
fully-received master-project line lands in Allocation & Routing (§15). Either way, the physical
stock created is **held** until §3 clears it.

---

## 2. Heat / batch / traceability

**Model:** four independent boolean flags on `bom_items`, set by Engineering/Design at BOM-authoring
time (`lib/db.js:3654-3657`): `requires_heat_no`, `requires_mtc`, `requires_supplier_batch`,
`requires_serial_no`. Each maps to its own `received_*` capture column
(`lib/db.js:3718-3721`, `bom_item_receipts` schema at `lib/db.js:3360-3371`).

```
bom_items.requires_heat_no / requires_mtc / requires_supplier_batch / requires_serial_no
        │  (Engineering-owned, frozen post-Release-BOM — TRACEABILITY_FIELDS,
        │   app/api/bom-items/[id]/route.js:55)
        ▼
components/ReceiveBomItemDialog.jsx  — REQUIRES_TO_RECEIVED map renders a required (*) field
        │                               per flag actually set on this line
        ▼
lib/bom-receiving.js :: missingTraceabilityFields(item, changed)
        │  — the ONE shared check (receive/route.js's own loop at lines 191-197, plus
        │    receivePiece()'s own duplicate check for the piece-tracking path, lines 111-119)
        ▼
bom_item_receipts.received_heat_no / received_mtc_no / received_supplier_batch_no /
received_serial_no / test_certificate_id  — stamped per delivery event (never per-line-only)
        │
        ▼
stock_pieces.heat_no / test_certificate_id  — inherited by receivePiece() at creation,
                                               then inherited by EVERY generation cutPiece()
                                               produces (used/remnant/scrap alike) —
                                               lib/stock-pieces.js:236-239, 258-263, 272-274
```

**Heat number is now always capturable, not just when flagged.** This session's audit found the
backend (`missingTraceabilityFields`, `receive/route.js:140`) already accepted `received_heat_no`
unconditionally, but the frontend only rendered the input when `requires_heat_no` was checked on
that specific line. Fixed: an optional "Heat number (optional)" field now always renders when the
required version isn't already showing (`ReceiveBomItemDialog.jsx`, new block, matches
`AddPieceDialog`'s existing precedent of a plain, optional heat field on the piece-receiving path).

**MTC is stronger than a text field** — `requires_mtc` additionally requires a real, linked Test
Certificate bank row (`test_certificate_id`, `missingTraceabilityFields` line 30), not just a typed
reference string. Picked/created via `CertPicker`, which also back-fills `received_mtc_no` from the
cert's own `certificate_no`.

**Certificate → project linkage is automatic, not a separate step.** The moment a piece carrying a
`test_certificate_id` is actually cut into a real project, `cutPiece()` auto-inserts a
`certificate_projects` row (`lib/stock-pieces.js:280-289`) — "using a cert is what allocates it,"
the same convention QC's own statutory-document editor already uses.

**Multi-unit-split traceability is separate again** — `bom_item_child_certificates`
(`lib/db.js:3417-3436`) records which certificate(s) apply to a specific `(bom_item, child project)`
allocation cell, a real many-to-many, human-recorded (not inferred), surfaced on
`getChildRoutingBoard()`'s `cells[].certificates`. This is a QC-side workflow (linked from the QC
statutory-document editor), not a Stores UI — Stores' own Allocate/Allocation-Routing screens don't
write to this table.

---

## 3. Inward QC Approval Gate

**This is the single most important state gate in the whole department** — it decides whether
received material is real, usable Stores inventory at all.

```
Every physical delivery (§1) → inward_approvals row, status='pending'
   (lib/db.js:4378-4393 — bom_item_receipt_id, bom_item_id, project_id,
    inventory_item_id/qty_scalar [scalar hold, populated by maybeReserveScalarStock],
    resubmission_of_id [chains rejected→resubmitted cycles])
        │
        ▼
QC department, Head-gated by default (action_permissions seed row:
  ('QC','qc.inward.decide',1), lib/db.js:4433)
        │
        ├─ approve → POST /api/inward-approvals/[id]/decide {decision:'approved'}
        │    ├─ releasePieceFromInwardHold(pieceId) for every held stock_pieces row on this
        │    │    receipt (status: pending_qc_inward → available, then auto-reserves it
        │    │    against the very bom_item it was received for — lib/stock-pieces.js:415-425)
        │    └─ releaseScalarFromInwardHold(approvalId) — credits inventory_items.on_hand,
        │         then reserves that qty via reserveFromStock() (lib/bom-receiving.js:228-237)
        │
        └─ reject → status='rejected', nothing released. Stock stays exactly where it was
             (pending_qc_inward pieces, un-credited scalar hold).
             POST /api/inward-approvals/[id]/resubmit → new inward_approvals row,
             resubmission_of_id points back at the rejected one (full history preserved,
             never mutated in place)
```

**Withholding, both physical-stock shapes:**
- **Piece-tracked (dimensional)**: `receivePiece({heldForInwardApproval: true, ...})` inserts at
  `status='pending_qc_inward'` instead of `'available'`, linked to the receipt event
  (`lib/stock-pieces.js:96-130`). Every existing `status='available'` filter (rollup, matching,
  reservation) already excludes it structurally — no separate gate logic needed anywhere else.
- **Scalar (non-dimensional, catalog-linked)**: `maybeReserveScalarStock()` does **not** credit
  `on_hand` at receipt time at all — it stashes `inventory_item_id`/`qty_scalar` directly on the
  `inward_approvals` row (`lib/bom-receiving.js:194-220`). `on_hand` only moves at approval time.

**A non-catalog-linked line still gets an `inward_approvals` row** (it's created unconditionally per
receipt, `creditBomItemReceipt`), but since neither `maybeCreatePieceStock` nor
`maybeReserveScalarStock` can do anything for it (both require `item_id`), that row's approve/reject
has no physical-stock effect — it exists purely as a paperwork/audit record for that delivery.

**Downstream consumers that correctly check this gate** (query the `pending_qc_inward`
status/`inward_approvals.status='pending'` before treating material as usable):
- `getProjectBom()`'s `readyForPacking` (`lib/data.js:1164-1178`)
- `getPendingPackingItems()` (`lib/data.js:~2073-2109`)
- `getDispatchWork()`
- `getUnroutedReceivedItems()` (§7/§8)
- `getPendingProductionMaterialLines()` (§10, both `UNION` branches)
- `getChildRoutingBoard()` (§15, multi-unit split-order routing) — **fixed, Round 1** (was
  previously the one confirmed gap in this list; see §18 Gap #1 for the fix and its full
  downstream-consumer trace)
- `reservePiece()`/`findCandidates()` — structurally, by never matching a non-`available` piece

No downstream readiness/routing consumer is currently known to skip this gate.

**Ownership Transfer is explicitly blocked on held material** — `transferPieceOwnership()` throws
if `piece.status === 'pending_qc_inward'` (`lib/stock-pieces.js:455-457`), a defensive fix
documented in its own code comment: transferring before approval would leave
`inward_approvals.project_id` pointing at the wrong project, permanently breaking the later
`releasePieceFromInwardHold()` call.

**Notification-only visibility for Stores while material is held**: `AwaitingQcClearanceCard`
(`StoresWorkspace.jsx:2052+`) reads `getPendingInwardApprovals()` and renders a read-only list on
the Receive a Delivery tab — Stores can see what's pending, but the decision stays QC's.

---

## 4. Inventory creation and stock custody

**Two structurally different physical-stock shapes**, chosen automatically per line
(`lib/bom-receiving.js:118-171, 194-220`):

| | Dimensional (plate/section) | Scalar (bought quantity) |
|---|---|---|
| Trigger | `category` in `DIMENSIONAL_CATEGORIES` + `item_id` set + `qty_text` suffix is a count unit (Nos/pcs/ea, `isCountUnit()`) | `category` NOT dimensional + `source='bom'` + `item_id` set |
| Function | `maybeCreatePieceStock()` | `maybeReserveScalarStock()` |
| Backing table | `stock_pieces` (find-or-create `inventory_items`, `track_pieces=1`) | `inventory_items.on_hand` (find-or-create) |
| Held state | `status='pending_qc_inward'` per physical unit | qty stashed on `inward_approvals.qty_scalar`, `on_hand` never touched |
| Released by | `releasePieceFromInwardHold()` | `releaseScalarFromInwardHold()` |
| Neither condition met | Nothing created — line stays a bare `bom_items` row, never reaches Inventory |

**Custody = two independent columns, not one.** This is stated explicitly in the code as "Ownership
≠ Reservation" (`lib/stock-pieces.js` comment above `owner_project_id` addColumn, `lib/db.js:4352`):
- `owner_project_id` — **entitlement**. Which project this physical piece is restricted to serving.
  Set once at receipt (`maybeCreatePieceStock`), inherited by every cut child. `NULL` = common/
  anonymous pool (any project can draw on it).
- `project_id` — **reservation**. Which project's demand line this piece is currently matched
  against, stamped by `reservePiece()`/`matchAndReserve()`. A piece can be owned by project A and
  currently unreserved (idle-but-owned); or unowned (common) and reserved to project B.

**Ownership Transfer** (`transferPieceOwnership()`, `lib/stock-pieces.js:440-471`) is the *only*
write path to `owner_project_id` outside receipt/cut inheritance — confirmed by the function's own
comment citing a direct research pass. Force-releases any active reservation first via
`releasePiece()` (which itself reopens the demand + notifies Stores if that demand is still open —
so a transfer can never leave a line silently looking "fulfilled" when the material just moved
away). Blocked on `consumed`/`scrap`/`pending_qc_inward` pieces. UI: `TransferOwnershipDialog`
(`StoresWorkspace.jsx`, added this session — was previously API-only with zero UI, per §18's own
Phase-0-7-audit note in the code).

**`reservePiece()`'s ownership guard is defense in depth, not just a suggestion enforced upstream**
(`lib/stock-pieces.js:578-589`): a piece already owned by a *different* project throws even on a
direct/forged call, regardless of whether `findCandidates()`'s own filtering already excluded it.

**Material mismatch guard on the scalar reservation path** — `reserveFromStock()` calls
`materialMismatchReason(bomItem, invItem)` (`lib/procurement.js:326-331`) before ever committing a
reservation; never blocks on merely-missing category/MOC (too common to be a real signal), only on
the two sides actively disagreeing.

---

## 5. Inventory dimensions / specs

**Two genuinely separate gaps this session's audit found and fixed** — a reuse gap and a
missing-schema gap, previously conflated:

```
items.default_category_fields_json / default_moc / bom_category   (Item Master catalog default)
        │
        ▼  components/StoresWorkspace.jsx :: pickCatalogItem()  — now mirrors
        │  components/BomLineFields.jsx :: ItemSearchField.pick() exactly (this session's fix;
        │  previously only seeded free-text `spec` from `detail_desc`, ignoring the structured
        │  default entirely)
        ▼
ItemFormDialog's local categoryFields state
        │
        ▼  save()  — NOW sends category_fields_json in the POST/PATCH body (this session's fix;
        │  previously computed the flattened `spec` string via categoryDisplaySpec() but never
        │  sent the raw structured object — a confirmed, fully wired dead end: the column existed,
        │  the read/display path existed, the form's local state existed, but nothing connected them)
        ▼
POST /api/inventory-items · PATCH /api/inventory-items/[id]
        │  FIELDS/INSERT column list widened to include category_fields_json (this session's fix)
        ▼
inventory_items.category_fields_json  (lib/db.js:4480 — same JSON shape bom_items/items already use,
                                        no second schema invented)
        │
        ▼  StoresWorkspace.jsx :: inventoryDimensions(it)  — reuses categoryDisplaySpec()
        │  (lib/section-shapes.js), the SAME formatter a BOM line's own spec renders through.
        │  Falls back to the legacy flattened `spec` string for any un-migrated row.
        ▼
Inventory table's "Dimensions" column (StoresWorkspace.jsx:2561, 2580) — plus a separate
"Grade" column (i.moc) alongside it (StoresWorkspace.jsx:2560)
```

**Taxonomy** (`lib/section-shapes.js:35-38`): `CATEGORY_LABEL` = plate, flat, round, square,
octagonal, angle, beam, channel, tee, pipe, standard, other. `GEOMETRY_SHAPES` (plate/flat/round/
square/octagonal) carry real per-dimension fields + a `kgPerM`/weight formula; `ROLLED_CATEGORIES`
(angle/beam/channel/pipe) instead carry a picked standard-size designation + `kg_per_m` — a
genuinely different input shape, both reunified through the one `categoryDisplaySpec()` output
function.

**A legacy row with no `category_fields_json` yet is not broken** — `inventoryDimensions()`'s
fallback to the flattened `spec` string means every pre-existing Inventory row still renders
something meaningful; nothing was retroactively migrated (consistent with this codebase's
established "forward-only, never backfill fabricated data" convention).

**`stock_pieces`' own dimension columns are a separate, coarser model** (`length_mm`/`width_mm`/
`thickness_mm`/`kg_per_m`/`density` — a plate/linear split, not the full per-category
`GEOMETRY_SHAPES` taxonomy) — used only for real physical pieces, not the `inventory_items`
catalog-line-level spec. The two are related but not the same schema.

---

## 6. Remnants / piece lineage / custody

**Cut** (`cutPiece()`, `lib/stock-pieces.js:175-362`) is Production's action, not Stores' — included
here because it's the other entry point into the same custody model §4 describes.

```
Production: CutDialog.jsx → POST /api/stock-pieces/[id]/cut
        │
        │  HARD GATE: source piece must be status='reserved' (Material Indent hard gate,
        │  2026-09-02 comment in code) — cutting a bare 'available' piece is not possible through
        │  any path. CAS on the status flip (line 218-222) so two concurrent cuts of the same
        │  piece can never both succeed.
        ▼
One transaction:
   source piece  → status='consumed'
   each "used" declared piece → new row, status='consumed' (leaves the books immediately)
   each "remnant" declared piece → new row, status='pending_receipt'  ◄── NOT 'available' yet
   any leftover weight → one 'scrap' row, auto-computed (never typed, never silently absorbs
                          an operator's dimension typo — an invalid entry throws, it doesn't
                          get dropped into scrap)
        │
        │  Every child inherits: heat_no, test_certificate_id, owner_project_id, unit_cost
        │  (lib/stock-pieces.js:236-239, 258-263, 272-274) — no re-entry needed at cut time.
        │  Codes are flat against the ROOT's own code (PL-0042-U2, PL-0042-R2), never
        │  compounding onto whichever immediate parent happened to be cut.
        ▼
remnant → notifyDepartment('Stores', kind:'remnant_pending_receipt')   (this closed a real,
        documented gap: Production previously never told anyone a remnant needed attention)
        ▼
Stores: PiecesDialog → "Confirm receipt" → POST /api/stock-pieces/[id]/confirm-receipt
        │  CAS: status='pending_receipt' → 'available'  (confirmPieceReceipt(),
        │  lib/stock-pieces.js:397-406)
        ▼
Piece is now genuinely reservable/matchable by ANY project's BOM line — lib/remnant-match.js's
findCandidates()/matchAndReserve() run automatically at the next Release BOM / single-item add;
Stores can also manually match it via the Pieces dialog's own Reserve action.
```

**Depth/lineage is correctly modeled and correctly rendered.** `groupPiecesByRoot()`
(`components/PieceLineage.jsx`) is a real, recursive, depth-agnostic walk — confirmed correct for
any generation. `StoresWorkspace.jsx`'s own `PiecesDialog`/`PieceRow` already used this correctly.
`components/PieceLineage.jsx`'s own default-exported component (used from `CutDialog.jsx`'s "View
lineage") previously hardcoded `depth={1}` for every child regardless of the real computed value —
**this was a confirmed, real bug, fixed in the prior session** (verified live against the real
`PL-0073-H62A5678` piece tree in the dev DB before the fix landed).

**There is no separate "Return to Stores" action, and none is needed** — the automatic
`pending_receipt` state IS the return; Production's only job is the cut itself. Both of the user's
originally-imagined "Production choices" (reuse elsewhere / return to Stores) resolve to the
identical `pending_receipt → confirmPieceReceipt → available → matchable-by-anyone` chain — there is
no code path where Production allocates a remnant to another project while bypassing Stores'
physical custody.

**One accepted, deliberate limitation**: a remnant becomes `pending_receipt` the instant the cut is
*submitted* (a database record), not when Stores physically confirms the piece is on the shelf — the
only real guard against premature use is the `pending_receipt` status itself blocking every
`status='available'` filter until Confirm receipt is clicked.

---

## 7. Allocate → Production

Covered jointly with §8 below (they're the same screen/table, split only by which routing checkbox
a row lands on) and §16 (the Production-vs-Dispatch vs. Requires-Mfg vs. Catalog-Default
distinction).

```
lib/data.js :: getUnroutedReceivedItems()  (Stores' Allocate tab data source)
   WHERE p.status='active' AND b.source='bom' AND b.purchase_status IN ('Received','In-Stock')
     AND project has NO children (a routing-eligible normal/sibling line)
     AND no existing bom_item_child_routing row for (bom_item_id, own project_id)
     AND NOT EXISTS pending inward_approvals for this line   ◄── fixed this session
        │
        ▼
components/StoresWorkspace.jsx :: AllocateTab
   table: [select ☐] Material | Project | Qty | Production ☐ | Dispatch ☐ | Requires Mfg (read-only) | Catalog Default ☑
   "Apply Allocations" — bulk, per selected row, 2 independent writes:
        │
        ├─ POST /api/bom-items/[id]/route-self  {routed_to: 'production'|'dispatch'}
        │    upsert bom_item_child_routing(bom_item_id, child_project_id=own project_id, routed_to)
        │    guards: must NOT have children (400 otherwise — use route-to instead);
        │            must be purchase_status='Received' (400 otherwise)
        │    on transition INTO 'production' → notifyDepartment('Production', kind:'indent_ready')
        │
        └─ PATCH /api/item-master/[id]  {default_requires_manufacturing}  (only if catalog-linked
             AND the staged value actually differs from the current catalog value)
             widened permission: Stores may write THIS ONE FIELD via stores.bom.set_manufacturing_default,
             exact-match only — bundling any other Item Master field falls through to the unmodified
             Engineering/Design-only path
        │
        ▼ (partial-failure handling, both writes independent — one failing never blocks the other)
   routing succeeded but Default failed → stays in a separate "Needs a retry" card with its own
        "Retry Default" action (re-issues only the failed PATCH)
   routing failed → row simply stays in the unrouted queue for a normal retry
```

**routed_to='production' side of the table** feeds §9/§10 (Material Demand / Material Indent
worklist) via `getPendingProductionMaterialLines()`.

---

## 8. Allocate → Dispatch / Packing

**Same Allocate screen as §7** — `routed_to='dispatch'` is the other checkbox on the same row. What
differs is the downstream consumer.

```
bom_item_child_routing.routed_to = 'dispatch'  (child_project_id = the item's own project_id)
        │
        ▼
readyForPacking, computed IDENTICALLY (by design, one predicate copy-pasted 3x, all fixed this
session to exclude pending-inward material) in:
   lib/data.js :: getProjectBom()            (line ~1160-1178)
   lib/data.js :: getPendingPackingItems()   (line ~2073-2109)
   lib/data.js :: getDispatchWork()

   readyForPacking = baseReady AND NOT pending-inward-review AND (
       line is not routing-eligible (stock/sas/split-master lines)
       OR self_routed_to === 'dispatch'
       OR (self_routed_to === 'production' AND production_done)
   )
   where baseReady = requires_manufacturing ? production_done : purchase_status in (Received, In-Stock)
        │
        ▼
POST /api/packing/from-bom  {project_id}
   — pulls every readyForPacking line not already on an existing draft list for this project,
     creates a new DRAFT packing_lists row + packing_items (qty via itemRollupQty, same
     rollup/unit-count math as everywhere else)
        │
        ▼
Dispatch packs it (own UI, outside Stores' scope) → status='packed'
        │
        ▼
POST /api/packing/[id]/submit-for-approval   (Dispatch action, dispatch.packing.submit_approval)
   — serves both first-submit and resubmit; a fresh submission is refused while the latest
     pre_dispatch_approvals cycle is anything but 'rejected'/absent
   → pre_dispatch_approvals row created, notifies QC Heads AND Production Heads
        │
        ▼
QC and Production EACH independently decide (POST /api/pre-dispatch-approvals/[id]/decide,
   Head-gated by default for both departments) — one row, two independent decision slots
   (qc_decision/production_decision). overall status = 'approved' only once BOTH approve;
   'rejected' if EITHER rejects. One deciding never blocks or waits on the other.
        │
        ▼  (only once overall='approved')
PATCH /api/packing/[id]  {status:'dispatched'}
   — HARD gate: rejects with 400 unless the packing list's latest pre_dispatch_approvals row is
     'approved' (app/api/packing/[id]/route.js:64-70)
   → every linked stock_pieces row still available/reserved → status='consumed'
   → postDispatchConsumption() posts the FULL unit_cost for a piece dispatched whole (never cut)
```

**A piece-tracked line dispatched without ever being cut** (a bought valve/fitting routed straight
to Dispatch, §15's own precedent for a non-manufacturing line) is closed out and costed here —
`postDispatchConsumption()` is a distinct accounting entry from `cutPiece()`'s own posting
(`sourceType: 'stock_piece_dispatch'` vs `'stock_piece_cut'`), confirmed the only two write paths
that ever set `stock_pieces.status='consumed'` anywhere in the app.

---

## 9. Material Demand

```
lib/data.js :: getOpenBomItems()
   WHERE purchase_status NOT IN ('Received','Cancelled','In-Stock')
   (deliberately NOT filtered on pending_review — CONFIRMED intentional, Round 1: see below)
        │
        ▼
app/stores/page.js  →  StoresWorkspace  →  "Material Demand" tab (NAV_ITEMS key: 'requests')
   — components/StoresWorkspace.jsx :: OpenRequestsCard
   — possibleMatches() badges (exact item_id match, or fuzzy keyword overlap against Inventory)
   — reorder-suggestion adjacency via the same TodaySummary chip mechanism
   — a pending_review=1 row renders its own "Stores Review" badge PLUS a "Procure" button
     (OpenRequestsCard, line ~1267-1276) — this IS the screen where Stores resolves that gate
```

**Round 1 — confirmed, not a gap.** The original audit flagged the `getOpenBomItems()`/
`getSourcingItems()` asymmetry (§18 old Gap #5) as needing a deliberate decision rather than an
assumption. Investigated: `OpenRequestsCard`'s "Procure" button is gated *specifically* on
`r.pending_review === 1` — this is the actual decision screen where Stores reviews a
Manual-allocation-mode-gated line and either Reserves it from stock or Procures it out to
Procurement. Filtering `pending_review` out of `getOpenBomItems()` (mirroring `getSourcingItems()`)
would delete those rows from the one screen that acts on them — Procurement already can't see a
`pending_review=1` line, so Stores not seeing it either would make it permanently invisible and
un-actionable. **Left unchanged, confirmed correct as-is.**

**Naming note, a real point of confusion this audit surfaced**: `app/stores/page.js` fetches BOTH
`getOpenBomItems()` (assigned to prop `openRequests`, feeds Material Demand) AND `getSourcingItems()`
(assigned to prop `bomItems`, feeds Receive a Delivery / Allocate a Delivery search) — the prop name
`bomItems` reads as if it might be `getOpenBomItems()`'s output, but is not. This exact naming
mismatch was the root cause of a real bug found and fixed earlier this session (Receive's "expected
delivery" date silently always showed `—` because it was reading the wrong data source). See §18
Gap #4 — the underlying naming confusion itself is not fixed, only the one bug it caused.

---

## 10. Material Indent (raised by Production)

```
lib/data.js :: getPendingProductionMaterialLines()   ◄── the worklist Production sees
   Two UNION ALL branches, both now pending-inward-gated (fixed this session):
     (a) self-routed: bom_item_child_routing WHERE child_project_id = bom_items.project_id
                       AND routed_to='production'
     (b) split-child:  bom_item_child_routing WHERE child_project_id != bom_items.project_id
                       AND routed_to='production'  (joined to the real child project for display)
        │
        ▼  GET /api/production/material-indent-lines
        ▼
components/MaterialIndentWorklist.jsx  (rendered inside components/WorkersPanel.jsx, tab='indent')
   — checkbox multi-select, "Create Material Indent (N)" — single OR multiple lines in one action
        │
        ▼  POST /api/material-indents   (gated: production.indent.create — a Production action,
        │  not a Stores one)
        ▼
material_indents  (header: indent_no, project_id, job_card_id, requested_by, status)
material_indent_items  (per line: inventory_item_id [resolved via getInventoryItemForBomItem,
        display/lookup hint only], bom_item_id, qty_requested)
        │
        ▼  notifyDepartment('Stores', kind:'indent_raised', actionKey:'stores.indent.release')
```

**Validation, server-side** (`app/api/material-indents/route.js:49-68`): every line needs either a
`bom_item_id` or `inventory_item_id`; a non-piece-tracked inventory line requires a real
`bom_item_id` (since `material_issues.bom_item_id` is `NOT NULL` — only a piece-tracked line's
consumption path, Cut, doesn't need one).

---

## 11. Production Requests (Stores' own queue of what was raised)

**Naming note**: there is no UI screen literally labeled "Production Requests" — the sidebar tab is
called **"Material Indents"** (`NAV_ITEMS`, `StoresWorkspace.jsx:2013`). Functionally, it *is*
Stores' queue of Production's requests — documented here under both names since the user's own
framing (§10 = Production raising, §11 = Stores acting on it) maps precisely to this real UI/data
split, just with a label difference worth knowing about.

```
GET /api/material-indents  (?status=open,partially_released filtered client-side to open ones)
        │
        ▼
components/StoresWorkspace.jsx :: IndentsCard
   — search box, bulk-select (scalar/batch lines only — a piece-tracked line always needs a
     specific physical piece chosen by hand, excluded from bulk-select by design)
   — per-line: piece-tracked → Select a specific available stock_pieces row + "Reserve piece";
              scalar/batch → qty input (capped at remaining) + "Release"
```

This is the read/action surface for §12 (Issue) below — see there for the two release mechanisms.

---

## 12. Stores Issue

**Two distinct release mechanisms**, chosen by the line's `tracking_mode`:

```
Scalar / batch line:
   POST /api/material-indents/[id]/items/[itemId]/release   {qty}
        │
        │  CAS-claim the quantity on material_indent_items FIRST (qty_released += ?,
        │  status derived via a live CASE expression, WHERE qty_released+? <= qty_requested —
        │  two concurrent releases of the same remaining amount can never both succeed)
        │  project cross-check: item's bom_item.project_id must equal the indent's own project_id
        ▼
   lib/material-issues.js :: issueMaterial({bomItemId, qty, jobCardId, indentItemId, ...})
        │  scalar: floor-checks available (on_hand − active reservations) BEFORE inserting —
        │          rejects on insufficient stock; decrements on_hand whenever a real
        │          inventory_items row exists, REGARDLESS of whether it's been costed yet
        │          (Round 1 fix — §18 Gap #3: previously both the floor check and the decrement
        │          were incorrectly gated on totalCost > 0, so a never-costed line's on_hand
        │          silently never moved on a real issue and was never floor-checked either)
        │  batch/serial: already-issued-via-Reserve→Issue lines get an audit-only row (I11's
        │          no-double-consumption guard); otherwise consumeStock() does real FIFO allocation
        ▼
   material_issues row INSERTED + (if costed — totalCost > 0, unchanged, a separate gate from the
   physical stock movement above) a journal entry posted (materialConsumptionLines)

Piece-tracked line:
   POST /api/material-indents/[id]/items/[itemId]/reserve-piece   {piece_id}
        │  calls lib/stock-pieces.js :: reservePiece()  — status='available' → 'reserved',
        │  bom_item_id/indent_item_id stamped. Does NOT create a material_issues row yet —
        │  Production's own Cut action (§6) is the actual consumption event for a piece.
```

**Direct issue also exists** outside the indent flow — `POST /api/material-issues` (Stores' own
"Log an issue" button, `MaterialIssuesCard`, `StoresWorkspace.jsx:1307+`), same `issueMaterial()`
function, `indentItemId: null`.

---

## 13. Issued to WIP

```
material_issues  (bom_item_id, job_card_id, qty, issued_by, issued_at, notes,
                   unit_cost, total_cost, indent_item_id)
        │
        ▼  GET /api/material-issues
        ▼
components/StoresWorkspace.jsx :: MaterialIssuesCard
   "What's left Stores for the shop floor, most recent first."
```

Every indent Release (§12) and every direct "Log an issue" both land here identically — one table,
one read, no distinction in this view between the two origins.

---

## 14. Reservations

```
lib/procurement.js :: reserveFromStock({inventoryItemId, bomItemId, qty})
   — piece/serial-tracked lines rejected outright (their own reserve actions exist elsewhere)
   — materialMismatchReason() guard
   — TOCTOU-safe: available = on_hand − active reservations, re-read inside one transaction
   — shortfall → splits the bom_item (splitQtyText/cloneBomItemForSplit, qty_resolved=1 on the
     clone so a later re-read never re-applies the unit-count multiplier — a documented,
     previously-real double-counting bug, now fixed at the source)
        │
        ▼
inventory_reservations  (inventory_item_id, bom_item_id, qty, status: active|released|issued)
        │
        ├─ Manual: components/StoresWorkspace.jsx :: ActiveReservationsCard
        │    POST /api/inventory-reservations/[id]/issue    → issueReservation()
        │    POST /api/inventory-reservations/[id]/release   → releaseReservation()
        │
        └─ Automatic (Auto allocation mode only — lib/procurement.js :: getAllocationMode(),
             app_settings key 'stores_allocation_mode', default 'auto'):
             lib/procurement.js :: autoReserveFromStock()  — exact catalog identity match
             (bom_item.item_id === inventory_items.item_id) ONLY, never fuzzy keyword — called
             from matchProjectPlainStock() at Release BOM time
        │
        ▼  issueReservation() — the real D9 "confirm" moment
   inventory_items.on_hand -= qty  (scalar) — OR consumeStock() (batch, real FIFO allocation)
   bom_items.purchase_status = 'In-Stock', inventory_item_id/inventory_qty stamped
```

**Release never touches `on_hand`** — nothing was decremented at Reserve time, only committed
against `available` (on_hand minus active reservations). A released reservation against a
`pending_review`-gated line re-notifies Stores it needs a fresh decision (`releaseReservation()`,
`lib/procurement.js:444-457`).

**Manual mode exists as a toggle but has no distinct enforcement code path of its own** — Auto mode
runs `autoReserveFromStock`/`matchProjectPlainStock` at Release BOM; Manual mode simply never calls
them, leaving every line to be reserved by hand via `ActiveReservationsCard`. This is by design
(`getAllocationMode()`'s own header comment: "undo the old always-manual behavior only by choosing
it here, not by special-casing every caller").

---

## 15. Multi-Unit Orders / Allocation & Routing

For split-order projects only (a master project with real child-unit projects,
`projects.master_project_id`).

```
components/StoresWorkspace.jsx :: AllocationRoutingSection  (own "Multi-Unit Orders" sidebar
   section this session, was previously stacked inside the same tab as plain Reservations)
   — queue-first: getSplitOrdersNeedingStoresAction() lists every master with unallocated lines
     or unrouted-ready cells; pick one → work it inline
        │
        ▼ Step 1: AllocationPanel  (getProjectAllocationSummary(masterProjectId))
   per bom_item on the master: received (Σ bom_item_receipts) − allocated (Σ
   bom_item_child_allocations) = available. Bundle-allocate: pick N children, one auto-computed
   per-unit qty (itemRollupQty, never hand-typed), all-or-nothing.
        │
        ▼  POST /api/bom-items/[id]/allocate  {child_project_ids: [...]}  OR  {child_project_id, qty_allocated}
   TOCTOU-safe (available re-read inside withTransaction) — INSERT bom_item_child_allocations
   (append-only ledger, never updated in place — history lives here directly, no separate log)
        │
        ▼ Step 2: ChildRoutingPanel  (getChildRoutingBoard(masterProjectId))
   cells: {bom_item_id, child_project_id, allocated, per_unit_required,
           ready: allocated >= per_unit_required AND NOT pending QC inward review,  ◄── Round 1 fix
           routed_to, certificates[]}
        │
        ▼  POST /api/bom-items/[id]/route-to  {child_project_ids: [...], routed_to}
   Server-side readiness RE-CHECKED (never trusted from the UI's filtered list) — rejects with the
   specific project numbers not yet fully allocated. Upsert into bom_item_child_routing (SAME table
   as §7/§8's route-self — child_project_id is a real different project here, not the item's own).
        │
        ▼
   getChildRoutingBoard() is the single shared source of truth, consumed identically by:
      POST /api/job-cards/batch-children    — job card per ready+production-routed cell
      POST /api/packing/batch-children      — packing list per ready+dispatch-routed cell
```

**Certificates** (`bom_item_child_certificates`) are surfaced on the board's `cells[]` but written
only from the QC side (statutory-document editor), never from either Stores panel here.

**This is the same `bom_item_child_routing` table as §7/§8** — `route-self` writes with
`child_project_id = the item's own project_id` (a single, implicit recipient); `route-to` writes
with `child_project_id` = a genuine different child project (one of potentially many recipients).
Two write paths onto one table because the two cases have structurally different invariants (one
recipient with no allocation step needed, vs. many recipients each needing an explicit qty split
first) — documented explicitly in `route-self/route.js`'s own header comment as a deliberate choice,
not an accident.

---

## 16. Actual routing vs. Requires Manufacturing vs. Catalog Default

Three genuinely independent facts, on three different tables, each answering a different question —
this was the subject of a dedicated design round this session and is worth stating precisely:

| Concept | Table.column | Who writes it | What it answers | Frozen? |
|---|---|---|---|---|
| **Requires Manufacturing** | `bom_items.requires_manufacturing` | Engineering/Design, at BOM-authoring time | "Does THIS specific line need to go through Production?" | Yes — frozen post-Release-BOM (`TRACEABILITY_FIELDS`, `bom-items/[id]/route.js:55`). Never written by any Stores action, under any scenario. |
| **Actual Routing** | `bom_item_child_routing.routed_to` | Stores, per delivery, via `route-self`/`route-to` | "Where does THIS RECEIVED material actually go — Production or Dispatch?" | No — an active, current-state upsert; can be re-routed to correct a mistake (history lives in `usb_audit`). Pre-filled from `requires_manufacturing` but always freely overridable. |
| **Catalog Default** | `items.default_requires_manufacturing` | Engineering (existing Item Master UI) **or** Stores (Allocate's "Catalog Default" checkbox, via the narrowed `item-master/[id]` PATCH branch) | "What should the NEXT BOM line built from this catalog item default to?" | No — directly, freely correctable by either department the moment they notice it's wrong. Has **zero** effect on this line's own routing/readiness. |

**The Allocate table shows all three as visually distinct elements** (this session's UI change,
confirmed with the user before building): Production/Dispatch checkboxes (writes Actual Routing),
a plain read-only "Requires Mfg" badge (displays the frozen per-line value, never editable here),
and a separate "Catalog Default" checkbox (writes the catalog field, disabled/`—` for a
non-catalog-linked line, since there's no `items` row to correct).

**The permission widening is exact-match, not a general Stores-can-edit-Item-Master door**
(`item-master/[id]/route.js:64-73`): a PATCH body is only accepted via the Stores path when its
*entire* editable-field set is exactly `['default_requires_manufacturing']`. Bundling that field
with any other Item Master field falls through to the unmodified, Engineering/Design-only
`requireEngineeringAction()` gate.

---

## 17. Permissions and audit logging

**Every Stores route is gated by `requireDepartment(user, 'Stores')` first**, then (for most
mutating actions) a specific `requireAction(user, 'Stores', '<key>')` check against
`action_permissions`. The full Stores action catalog (`lib/action-permissions.js:53-71`):

```
stores.bom.receive                       — receive/route.js
stores.bom.allocate                      — allocate/route.js (multi-unit)
stores.bom.route                         — route-self/route.js, route-to/route.js
stores.bom.set_manufacturing_default     — item-master/[id]/route.js (narrowed branch)
stores.indent.release                    — material-indents/.../release, .../reserve-piece
stores.inventory.write                   — inventory-items POST/PATCH
stores.procure                           — send a Stores-Review line to Procurement
stores.allocation_mode.write             — Auto/Manual toggle
stores.reservation.reserve / .issue / .release
stores.piece.transfer_ownership
stores.gir.write                         — Gate Inward Receipts
stores.gatepass.write / .approve         — Gate Passes
```

**None of these are Head-gated by default** — `action_permissions` has zero seeded rows for any
`stores.*` key (confirmed by grep across `lib/db.js`'s migration history). Every Stores department
member can perform every Stores action unless an admin later configures a Head-gate manually via
Settings → Action Permissions. This is a deliberate contrast with the two adjacent workflows this
department depends on, both of which ARE Head-gated by default: `qc.inward.decide` (§3) and
`qc.predispatch.decide`/`production.predispatch.decide` (§8).

**Audit logging** — every mutating action calls `audit()` (shared `usb_audit` table), with a
consistent naming convention: `bom_item_received`/`bom_item_partial_receipt`/
`bom_item_receipt_split`, `bom_item_self_routed`, `bom_item_routed`, `bom_item_allocated`,
`bom_item_auto_reserved`, `stock_piece_ownership_transferred`, `inward_approval_approved`/
`inward_approval_rejected`/`inward_approval_resubmitted`, `indent_raised`, `indent_released`,
`item_master_edit`, `packing_status_change`, `predispatch_submitted`,
`predispatch_qc_approved`/`predispatch_production_rejected` (etc., dept-parameterized),
`inventory_item_created`/`inventory_item_edit`.

**Notification fan-out** (`lib/notify.js`'s `notifyDepartment`/`notifyDepartmentHeads`) runs
alongside audit logging at most of these same transitions — QC on every new inward approval,
Production on every routing-into-'production' transition, Stores on every indent raised/remnant
cut/reservation released-while-still-needed, both QC and Production Heads on pre-dispatch submission,
Dispatch on pre-dispatch decision.

---

## 18. Gaps, inconsistencies, and dead ends found

Ranked by real-world impact, not by section order. Each states exactly what was checked, not just
what's suspected. **Round 1** (this same working session, after the original audit) closed the one
Critical gap and one of the two "Important" gaps the user judged genuinely functional; the third
("Important") item turned out, on investigation, not to be a gap at all. Everything else below is
unchanged from the original audit and remains open.

### Fixed — Round 1

**Gap #1 (was Critical) — `getChildRoutingBoard()` never checked the Inward QC Approval gate. FIXED.**
Original finding: confirmed by reading the function in full (`lib/data.js:1313-1365` at the time),
its `ready` computation was purely `allocated >= per_unit_required`, with zero reference to
`inward_approvals` — the same class of bug already fixed elsewhere for the single-project routing
path (`getUnroutedReceivedItems()`, `getPendingProductionMaterialLines()`), but never applied to this
structurally separate, parallel implementation for the multi-unit split-order path. Confirmed
consequence, traced through both real downstream consumers: `POST /api/job-cards/batch-children` and
`POST /api/packing/batch-children` both gate directly and only on `getChildRoutingBoard()`'s own
`ready`/`routed_to` fields — meaning a split-master's allocated-but-QC-unapproved material could be
routed, then used to generate a real job card or a real packing list, before QC ever reviewed it.

**Fix applied**: `getChildRoutingBoard()` now fetches every `bom_item_id` on the master project with
a pending `inward_approvals` row (scoped to `b.project_id = masterProjectId`, since `bom_items` only
ever lives on the master, never per-child) and ANDs `!pendingInwardIds.has(bom_item_id)` into each
cell's `ready` computation — the identical guard shape already used at the other four readiness
sites. **Verified, code-level, through every real consumer**: `POST /api/job-cards/batch-children`
and `POST /api/packing/batch-children` both read only `cell.ready`/`cell.routed_to` with no other
assumption, so they inherit the fix with zero changes of their own; `components/
ChildRoutingPanel.jsx` already disables a non-ready cell's checkbox (`disabled={!c.ready}`), so a
held cell now correctly renders unroutable instead of falsely offering it; `getSplitOrdersNeedingStoresAction()`'s
own "unrouted ready cells" count now correctly excludes held cells too. Zero behavior change for the
common case (no pending approvals → the new Set is empty → `ready` reduces to exactly the original
computation). `npm run lint` clean.

**Gap #3 (was Important) — an uncosted line's `on_hand` was silently never decremented on direct
Issue. FIXED.** Original finding: `issueMaterial()`'s scalar branch only ran the floor check AND the
`on_hand -=` decrement when `totalCost > 0` — i.e., only once the inventory item already had a
non-zero `avg_cost`. A never-costed catalog item (real stock, e.g. released from the Inward Approval
hold, but with no Vendor Bill approved against it yet) got no floor check and no stock decrement at
all — the `material_issues` paperwork row was still created, but `on_hand` never moved and was never
validated against over-issue.

**Confirmed intended behavior before fixing, not assumed**: `consumptionCost()` (`lib/
inventory-costing.mjs`) returns `qty * avgCost`, and `inventory_items.avg_cost` is `NOT NULL DEFAULT
0` (`lib/db.js:2860`) — so an uncosted item's `totalCost` is always exactly `0`, never `null`,
confirming the gate silently fires on every never-costed line, not just an edge case. Re-reading the
function found a separate, correctly-scoped `if (inventoryItem && totalCost > 0)` block 20-odd lines
below the floor-check (the actual journal-entry posting) — proving the `totalCost > 0` gate was
designed for the accounting decision, and had been mistakenly reused to also gate the unrelated
physical-quantity movement above it. Every sibling scalar-credit path in the codebase (e.g.
`releaseScalarFromInwardHold()`, §3) credits `on_hand` unconditionally, independent of costing —
confirming the intended behavior is "quantity always moves; accounting posts only when a real cost
basis exists," not the reverse.

**Fix applied**: the floor-check and the `on_hand` decrement are now gated on `inventoryItem` alone;
the accounting-posting block keeps its own, correct `totalCost > 0` gate untouched. **Verified,
code-level, through every real caller**: `app/api/material-issues/route.js` (direct "Log an issue")
has no pre-claimed state and returns a clean 400 on any throw — the new "Insufficient stock" path for
a previously-silent uncosted over-issue surfaces safely. `app/api/material-indents/[id]/items/
[itemId]/release/route.js`'s catch block generically reverts its own CAS-claimed `qty_released`/
`status` on *any* thrown error from `issueMaterial()`, regardless of cause — confirmed this already
covers the new throw path with zero risk of a phantom "released" claim against material that was
never actually moved. `npm run lint` clean.

### Investigated, confirmed NOT a gap — Round 1

**Gap #5 (was Important) — `getOpenBomItems()` not filtered on `pending_review`. CONFIRMED CORRECT,
NOT FIXED.** Original finding stated this "may be entirely intentional... wasn't possible to
determine from the code alone whether this is working as intended or an oversight." Investigated by
reading the actual UI consumer: `components/StoresWorkspace.jsx :: OpenRequestsCard`'s "Procure"
button is gated *specifically* on `r.pending_review === 1` (line ~1272-1276) — this screen is the
real decision point where Stores reviews a Manual-allocation-mode-gated line and either Reserves it
from stock or Procures it out to Procurement (the `pending_review` state itself is rendered as its
own "Stores Review" badge on the same row). Filtering `pending_review` out of `getOpenBomItems()` the
way `getSourcingItems()` does for Procurement's own queue would delete those rows from the one screen
built to act on them — since Procurement already can't see a `pending_review=1` line, doing the same
on the Stores side would make it permanently invisible and un-actionable anywhere in the app. **No
code changed** — the asymmetry is the correct, intended design, not an oversight.

### Still open — Important, narrower blast radius

**Gap #2 — Piece-tracked lines never get a Material Indent hard-floor check on stock actually being
QC-cleared at the point Production picks a piece to reserve.** `IndentItemRow`'s piece picker
(`StoresWorkspace.jsx:1478-1484`) fetches `GET /api/stock-pieces?inventory_item_id=` and filters
client-side to `status === 'available'`. Since a held piece sits at `pending_qc_inward`, not
`available`, it's correctly excluded — this is NOT a gap on its own. Documented here only because it
was checked as part of tracing Gap #1's blast radius, and confirmed clean: the piece-reserve path is
safe.

**Gap #4 — A confusing prop-naming pattern in `app/stores/page.js` already caused one real bug and
remains a standing risk.** `getSourcingItems()`'s result is passed to `StoresWorkspace` as the prop
`bomItems`, which reads as if it should be `getOpenBomItems()`'s output (the function whose name it
most resembles) — it is not. `getOpenBomItems()`'s result is instead passed as `openRequests`. This
exact mismatch was the root cause of an earlier real, confirmed bug (Receive's "expected delivery"
date always reading `—`, since the wrong data source was read) — already fixed for that one
symptom, but the underlying naming ambiguity that caused it is untouched, and could mislead a future
change the same way. Not fixed this round — the user's instruction was Gap #1 + genuinely functional
gaps among #3/#5 only; this is a naming/readability risk, not a functional bug on its own.

### Naming / documentation-level, not functional

**Gap #6 — "Production Requests" (the user's own framing, §11) has no matching UI label.** The
actual Stores-side sidebar tab is titled "Material Indents" — functionally identical to what the
audit's own §10/§11 split describes, but a reader looking for a tab literally named "Production
Requests" will not find one. Documented in §11 directly; no code change implied.

**Gap #7 — The Allocate table's "Requires Mfg" and "Catalog Default" columns sit in visually
adjacent, easily-conflated positions**, and their underlying data model (two genuinely separate
fields on two separate tables, per §16) is not self-evident from the UI alone without the tooltip
text already present on both column headers. Not a functional gap — the write paths are correctly
separated and independently confirmed exact-match-gated — but worth naming as a residual UX-clarity
risk for a first-time user, distinct from the two "should we let Stores edit Requires Mfg directly"
options already explicitly decided against this session (kept read-only, per direct confirmation).

### Checked and found NOT to be a gap (stated explicitly per the instruction not to overstate)

- `route-self`'s upsert (`ON CONFLICT ... DO UPDATE`) is confirmed retry-safe — a concern raised in
  an earlier planning pass, now directly confirmed true by reading the actual SQL.
- The sibling-split pre-check (planned recipients not pre-selected by default) — was a real gap,
  confirmed fixed earlier this session (`ReceiveBomItemDialog.jsx`'s `useEffect` gated on `status`).
- `inventory_items.category_fields_json` never persisting — was a real, fully-wired dead end
  (column existed, display path existed, form state existed, nothing connected them), confirmed
  fixed earlier this session across both API routes and the form's `save()`.
- Heat number gated behind `requires_heat_no` with no optional path — confirmed a real UI-only gap
  (the backend always accepted it), fixed earlier this session.
- `getSplitOrdersNeedingStoresAction()`'s own N+1 query shape (one `getProjectAllocationSummary` +
  `getChildRoutingBoard` pair per split master) is self-documented in its own `ponytail:` comment as
  a known, accepted scaling limit while split orders remain rare — not re-flagged here as a new
  finding.

---

## 19. Files read during this audit (for traceability)

**Database schema**: `lib/db.js` (all `CREATE TABLE`/`addColumn` statements for `bom_items`,
`stock_pieces`, `inventory_items`, `inventory_reservations`, `inward_approvals`,
`bom_item_receipts`, `bom_item_child_routing`, `bom_item_child_allocations`,
`bom_item_child_certificates`, `bom_item_expected_children`, `material_indents`,
`material_indent_items`, `material_issues`, `gate_inward_receipts`, `gate_passes`,
`gate_pass_items`, `stock_receipts`, `pre_dispatch_approvals`, and the `action_permissions` seed
rows).

**Core business logic**: `lib/stock-pieces.js` (full), `lib/remnant-match.js` (full),
`lib/procurement.js` (reserve/issue/release/auto-reserve functions, full), `lib/bom-receiving.js`
(full), `lib/material-issues.js` (full), `lib/tracking-mode.js` (full), `lib/action-permissions.js`
(Stores catalog + seeded Head-gates), `lib/section-shapes.js` (category taxonomy + display
formatter), `lib/data.js` (`getUnroutedReceivedItems`, `getOpenBomItems`,
`getPendingProductionMaterialLines`, `getProjectBom`'s readyForPacking, `getPendingPackingItems`,
`getDispatchWork`, `getInventoryItems`, `getPlannedRecipients`, `getProjectAllocationSummary`,
`getChildRoutingBoard`, `getSplitOrdersNeedingStoresAction`, `getPendingInwardApprovals`,
`getDispatchApprovalQueue`, `getInventoryItemForBomItem`).

**API routes**: `app/api/bom-items/[id]/receive/route.js` (full), `app/api/bom-items/[id]/
route-self/route.js` (full), `app/api/bom-items/[id]/route-to/route.js` (full), `app/api/bom-items/
[id]/allocate/route.js` (full), `app/api/inventory-items/route.js` + `[id]/route.js` (full),
`app/api/inward-approvals/[id]/decide/route.js` (full), `app/api/inward-approvals/[id]/
resubmit/route.js` (full), `app/api/pre-dispatch-approvals/[id]/decide/route.js` (full),
`app/api/packing/[id]/route.js` (dispatch-gate section), `app/api/packing/from-bom/route.js`
(full), `app/api/packing/[id]/submit-for-approval/route.js` (full), `app/api/item-master/
[id]/route.js` (full), `app/api/material-indents/route.js` (full), `app/api/job-cards/
batch-children/route.js` + `app/api/packing/batch-children/route.js` (gate-check sections),
`app/api/material-issues/route.js` (full, Round 1), `app/api/material-indents/[id]/items/
[itemId]/release/route.js` (full, Round 1 — the `issueMaterial()` catch/rollback path).

**Frontend**: `components/StoresWorkspace.jsx` (in full — `ItemFormDialog`, `AddPieceDialog`,
`AllocateTab`, `ActiveReservationsCard`, `IndentsCard`/`IndentItemRow`, `GateInwardReceiptsCard`,
`ReceiveDeliveryTab`, `BomGrnTab`, `AllocationRoutingSection`, `InventoryTab`, `NAV_ITEMS`,
`OpenRequestsCard` — Round 1's own Gap #5 investigation), `components/ReceiveBomItemDialog.jsx`
(in full), `components/MaterialIndentWorklist.jsx` (wiring confirmed via `WorkersPanel.jsx`/
`app/api/production/material-indent-lines/route.js`), `components/ChildRoutingPanel.jsx` (Round 1
— confirmed it reads only `cell.ready`/`cell.routed_to`, no other assumption broken by the fix),
`components/PieceLineage.jsx` (depth-fix region), `app/stores/page.js` (full).

**Round 1 additions**: `lib/inventory-costing.mjs` (`consumptionCost()`, full — confirmed
`avg_cost`'s `NOT NULL DEFAULT 0` schema means an uncosted item's `totalCost` is always exactly `0`,
never `null`, before touching the Gap #3 fix).

---

## 20. What this audit + Round 1 verified, and what it explicitly did not

**Verified (direct source-code reading, cross-checked against real schema/route/component code):**
- Every table's real, current column set (via `addColumn` history + base `CREATE TABLE`, not a
  design doc's description of intended schema).
- Every state transition named in §0-§17, traced to the specific line(s) of code that perform it.
- Every guard/validation named, confirmed present in the actual route handler, not assumed from a
  comment.
- The exact shape of Gap #1 (original audit), including its two real downstream consumers,
  confirmed by reading both consumer routes directly, not inferred from `getChildRoutingBoard`'s own
  comment alone.
- That no `stores.*` action key has a seeded Head-gate (confirmed by grep across the full migration
  history, not assumed from the pattern of other departments).
- **Round 1's Gap #1 fix**: the new pending-inward guard's SQL is valid (same join shape as the
  other four already-fixed sites), the `Promise.all`/destructure ordering is correct (8 items,
  matching positions), and it propagates correctly with zero behavior change for the common case
  (empty pending set → identical to the pre-fix computation) through all four real consumers named
  above.
- **Round 1's Gap #3 fix**: `consumptionCost()`'s exact return value for an uncosted item (always
  `0`, confirmed against the schema, not assumed), and both real callers of `issueMaterial()` (the
  direct-issue route and the indent-release route) — confirmed neither can be left in an
  inconsistent state by the fix's new throw path (the direct route has no prior state to roll back;
  the indent route's catch block generically reverts its own CAS claim on any thrown error,
  regardless of cause).
- **Round 1's Gap #5 investigation**: `OpenRequestsCard`'s "Procure" button is gated on
  `r.pending_review === 1`, confirmed by reading the actual JSX, not inferred — the basis for
  leaving `getOpenBomItems()` unchanged.
- That the fixes made in this same working session (heat number, sibling pre-select,
  `category_fields_json` persistence, both original pending-inward-gate fixes, the Allocate table's
  three-column split, and Round 1's own three items) are present in the current working tree exactly
  as described, by reading the actual current file contents.
- `npm run lint` — clean, 876 JavaScript files, re-run after Round 1's fixes.

**NOT verified — explicitly out of scope, per instruction, for both the original audit and Round 1:**
- No browser/UI click-through was performed at any point. Every UI description above is derived
  from reading the component source, not from observing the rendered page — this includes Round 1's
  fixes: `ChildRoutingPanel.jsx`'s disabled-checkbox behavior for a newly-not-ready cell, and
  `issueMaterial()`'s new "Insufficient stock" error surfacing in either UI, were confirmed by
  reading the consuming code, not by clicking through the app.
- No live query was run against the real (shared, remote) Turso database at any point — no claim
  here, in either the original audit or Round 1, rests on "I checked and there are N real rows in
  this state right now."
- The interaction between Stores and the QC statutory-document/certificate workflow
  (`bom_item_child_certificates`' write side) was read only far enough to confirm Stores never
  writes to it — the QC-side mechanics that populate it were not independently re-audited here
  (already covered in this codebase's own QC documentation).
- Gate Inward Receipts / Gate Passes (§0's diagram references them only at the very top) were
  confirmed to exist and gate correctly at a schema level, but their own full UI/route flow was not
  re-traced in either pass — they're upstream of Receiving, not part of the 17 numbered sections
  originally requested.

This document is accurate as of the current working tree, including Round 1's fixes. Gaps #2, #4,
#6, and #7 remain open and untouched — no further architectural/UI change has been made beyond
Gap #1's data-layer fix and Gap #3's floor-check/decrement fix.
