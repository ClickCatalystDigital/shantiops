# Operations Tab — shared framework rollout

Generalizes `SYSTEM.md` §3d ("Operations tab — standards for every department's dashboard card")
and `DESIGN-OPS-REDESIGN.md`'s Design-only unified card into one shared implementation used by
Procurement/Stores/Production/Design/Engineering. Companion doc — read those first for the
standard this builds on; this file only tracks what changed and why, kept short on purpose.

## The shared-component decision

Rather than five near-copies of `DesignOperationsCard.jsx`, this pass builds one shared set:
`components/OperationsCard.jsx` (flow → incidents → table, one Card), `OperationsFilterBar.jsx`
(one shared `FilterPills` row for the whole page, filtering every card below it at once — not one
pill row per card), and `MasterWorkTable.jsx` (search + pagination + a declarative `columns`
config, replacing both `MasterBomTable.jsx` and `DesignMasterTable.jsx`).

This is a deliberate exception to `{Dept}Flow.jsx`'s "copied, not abstracted" convention — that
convention exists because each department's *stages* genuinely differ enough that abstracting them
buys nothing. The card/section/table **wrapper** layer is structurally identical across every
department (row 1 flow, row 2 incidents, row 3 table), with only the Flow component, column shape,
and work-list differing — the case where one shared, prop-configured component is the right call.
`{Dept}Flow.jsx` files themselves stay separate and copied, per the existing convention — they only
gained a `bare` prop each (matching `DesignFlow.jsx`'s existing pattern) so `OperationsCard` can
embed them.

`columns` is plain data (`{ key, label, width, kind, field }`), not render functions — `app/page.js`
is a Server Component instantiating Client Components, and a function prop can't cross that
boundary. `MasterWorkTable` interprets `kind` (`progress` / `bottleneckChip` / `ratioText` / `text`)
itself.

## Per-department table — bucketing `getBomWork`'s shared rows

Procurement/Stores/Production/Engineering all read the same `bom_items.purchase_status` pipeline.
Per `BOM_FIELD_OWNERS`' field-ownership split, each department's table shows only the slice it
currently needs to act on (`lib/data.js`'s `bucketBomWork`, no new query):
Engineering = missing BOM (`total === 0`), Procurement = any open D4 stage, Stores = `Transit`,
Production = `Received`. `getBomWork`'s own filter was widened to also keep fully-`Received`
rows (previously dropped once `open === 0`) — otherwise Production's bucket would always be
empty for a project that's fully received.

## The Open Actions grid rule

A single-department view of Design/Procurement/Stores/Production/Engineering hides
`OperationsAttentionSection` (the "Open Actions" grid) — the unified card's table `Bottleneck`
column + the project page's own Open Actions card already cover that ground. PM/multi-department
views keep the grid (still the only cross-department aggregate view there). Every other
department keeps the grid unconditionally — they have no unified card to fall back on yet.

## Checklist

- [x] Design migrated onto the shared components (also fixes its old plain `3/9` progress text —
      it now uses the same `ProgressBar` treatment as the BOM-owning departments).
- [x] Procurement
- [x] Stores
- [x] Production
- [x] Engineering

## Explicitly deferred

- **Accounts** — no flow card existed before this pass (a separate, concurrent effort added
  `AccountsFlow.jsx`/`getAccountsFlowCounts` as a standalone card, same as Sales/Installation/HR/
  QC below — not yet on the unified-card pattern here, since it has no per-project master table).
- **HR / QC / Installation / Dispatch / Sales** — no per-project master table exists for any of
  them yet, so they keep their original standalone Flow cards + the Open Actions grid. A future
  pass building `get{Dept}Work()` + a table for one of these can then fold it into
  `OperationsFilterBar`'s `cards` array the same way this pass did.

## For whoever folds this into `SYSTEM.md` §3d later

Once this has been live a while, fold a dated summary into §3d (same "kept as historical record"
precedent as `PROCUREMENT-CHANGES.md`/`STORES-SALES-CHANGES.md`) — the unified-card shape, the
shared-component list, and the Open Actions grid rule are the parts worth keeping there; this file
can stay as the decision log.
