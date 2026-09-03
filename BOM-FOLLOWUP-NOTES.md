# BOM follow-up — to think through after Structure Templates ships cleanly

Noted by the user mid-build, explicitly deferred until templates are done without gaps. Nothing
here is scoped or planned yet — just captured so it isn't lost.

## 1. Capacity/configuration data on System/Subsystem/Assembly/Sub-assembly nodes

Is there anywhere in the UI or schema today to record "this is the 500kg/hr variant" vs. "1000kg/hr
variant" of a Boiler (or any node)? Directly relevant to Structure Templates' own known limitation
(§3 of the templates plan — a template inserts frozen specs verbatim, right structure/wrong numbers
for a different capacity). Needs its own design pass: where does capacity live (a field on
`bom_assemblies`? on `projects`? something else), and does it ever drive anything automatically, or
is it purely informational/labeling for now.

## 2. A BOM-wide quantity multiplier for multi-unit projects — DONE (implemented and live-verified, uncommitted)

Answered exactly as the open questions here anticipated: the "unit count" is **not** a new concept
— it's the *same* multiplier chain `rollupQty()`/`itemRollupQty()` already computed, just reused via
the existing per-node "Local quantity" field (`bom_assemblies.qty`, `NodeOverviewTab.jsx`), which
already lives at any node level (so a project mixing single-unit and multi-unit systems, e.g. one
shared Chimney vs. 50 Boiler units, sets the multiplier only on the subtree that actually repeats).
A live read-only DB check found **zero** existing `bom_assemblies` rows anywhere had `qty != 1`, so
wiring it in was fully backward-compatible for every existing project.

The real gap was narrower than the question implied: that multiplier was already computed but never
*consumed* — every real Procurement/Stores/Dispatch quantity (`po_items.qty`,
`inventory_reservations.qty`, `packing_items.qty`) was independently re-parsing the leading number
off `bom_items.qty_text` directly, ignoring the rollup chain entirely. Fixed at the 6 real call
sites (`app/api/purchase-orders/route.js`, `lib/procurement.js`'s `addItemToDraftPO`/
`autoReserveFromStock`, `lib/remnant-match.js`'s `matchAndReserve`, `app/api/packing/from-bom/route.js`,
`StoresWorkspace.jsx`'s Reserve dialog default) to call `itemRollupQty()` instead — no baking into
`qty_text` (rejected: no precedent in this codebase for overwriting a computed value into a free-text
field, and it would collapse the honest "per-instance vs. total" distinction the schema already
encodes). Per an explicit user decision, the rolled-up total is used **automatically** wherever these
6 sites compute a real quantity — no opt-in step — and the math is always shown next to the number
(e.g. "100 Mtrs = 2 Mtrs × 50") in Procurement's Sourcing/Status views, the Stores Reserve dialog, and
Dispatch's packing draft (deliberately **not** shown once a packing list moves past draft — the
frozen `qty` column would otherwise risk visibly disagreeing with a since-changed live multiplier).
Answers "does it retroactively affect existing lines" too, observed live during testing: yes, always
— the rollup is never frozen per-item, so a node's multiplier changing after a dimensional line was
already partially remnant-matched correctly re-chases the shortfall against the new total on the next
Release BOM, with no separate "re-apply" step needed.

Live-verified end to end against the real dev DB (baseline qty=1 byte-identical to pre-change
behavior; qty=5 correctly produced 10 in every one of the 6 real tables; a nested 5×3 nested-node
chain correctly produced ×15, ×30 combined with the item's own qty, proven through a real PO;
draft-only packing-label gating confirmed by moving a real list to `packed` and confirming the label
disappears) — full record earlier in this conversation. Work Orders' `qty_planned` deliberately left
untouched (100% hand-typed, no BOM linkage exists or should exist — a Work Order legitimately
produces a subset of the total). **Not yet committed** — sitting as uncommitted local changes
alongside Structure Templates, pending the user's own review/commit decision.

## 3. Calc Sheets / Drawings split, submission workflow, and customer-comment visibility

- Move Drawings out of Calc Sheets into its own top-level nav tab. Needs a decision on what — if
  anything — a Calc Sheet's own output should feed as input into a Drawing (today they're linked via
  `calc_sheet_drawings`, §5ay, but "linked" isn't the same as "one feeds the other's actual content").
- Designer submission status (Ravi/Vijay, per SYSTEM.md §5f's `not_started/in_progress/
  under_review/approved/as_built` ladder) — the user wants an explicit "Submit" action: status shows
  Pending until submitted, flips to Under Review on submit, and that submit should notify the Design
  Head (engg_head/design_head — user confirmed these are the same person/role in this company).
  Check first whether `lib/notify.js` already covers this transition or not before building anything
  — the user's own words: "I think we partially have this notification system."
  **Not actually re-checked against the live code this turn** — SYSTEM.md §5f already states
  Designers can move a drawing through `not_started/in_progress/under_review` themselves, which
  needs confirming (or finding stale) with a real grep before assuming either way — don't trust a
  guess here over checking the actual current code when this is picked up. What's genuinely unclear
  and worth checking fresh: whether that existing transition already fires any notification to the
  Head, and whether "Pending" in the user's own words maps to `not_started` or something not yet
  modeled.
- The customer-visibility toggle's UI needs to be clearer/better for the Design Head — worth a
  design pass on its own (today it's a small checkbox, no context on what "visible" actually
  triggers downstream — §6, the Customer Portal document-sharing gate).
- **Real, currently-open gap — checked live, this one is accurate.** A drawing comment system
  already exists (`app/api/calc-drawings/[id]/comments/route.js`, `lib/calc.js`'s
  `getDrawingComments`/`addDrawingComment`) and already lets the owning project's customer read/post
  when `calc_drawings.customer_visible` is set, alongside any internal user. But the internal side is
  gated by `requireCalcAccess` — **any** Design/Engineering department member, not just the Head — so
  today a plain Designer already CAN read and post into a thread the customer is in, with no
  Head-approval gate at all. The user's ask is real: add a Head-only visibility/posting gate on the
  customer side of that same thread, distinct from the department-wide access this route currently
  grants. This is a change to an existing route (`authorize()`'s internal branch), not a
  from-scratch comment system to build.

## 4. Post-release BOM flow into Production/QC, starting with QC's TC attachment

After Structure Templates ships: release a real BOM, verify Procurement + Stores are actually
notified correctly (the existing `bom_released`/Stores-notify hooks, §3b/§5a — re-verify against
current code, don't assume still correct), then trace what Production and QC see once a BOM is
released — the stated end goal is QC needs to start attaching Test Certificates to BOM items (the
existing `qc_document_parts`/`link-parts` flow, §5d/§5ao) on a project that went through this year's
BOM-rebuild work, not just the older seeded demo projects.
