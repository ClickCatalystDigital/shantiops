# Entity-ID tagging in incident/task free text

Companion doc to `operations-tab-changes.md` (same "decision log kept as historical record"
precedent as `PROCUREMENT-CHANGES.md`/`STORES-SALES-CHANGES.md`). Written mid-build so a fresh
chat can pick this up without re-deriving context.

## What this is

Lets someone raising an incident/task (`TicketsPanel.jsx`'s `RaiseDialog`), or commenting on a
drawing (`CalcWorkspace.jsx`), reference another entity — a material (BOM line), job card, work
order, drawing, or NCR — by a short code, and have that reference render as a clickable link with
a hover tooltip showing that entity's current status, instead of sitting as dead free text.

## Status: fully shipped and browser-verified. Three follow-ups explicitly deferred, all scoped.

### Bug fixes

- `tasks.body` didn't exist as a column, and `RaiseDialog.submit()` never sent `form.body` to the
  backend even though the UI collected it — free-text details were silently discarded before this
  pass. Fixed: `lib/db.js` (`addColumn(client, 'tasks', 'body TEXT')`),
  `app/api/production/tasks/route.js` (accepts + inserts `body`), `TicketsPanel.jsx` (sends it).
- `components/WorkersPanel.jsx:189` showed raw `#${jc.id}` in its job-card picker despite
  `job_cards.jc_no` existing since 2026-08-26 — fixed to show `jc.jc_no`.

### Resolution registry — `lib/entity-refs.js` (new)

Resolves a typed code to `{type, id, label, href, project_no, detail: {status, meta}}`. One
registry entry per prefix:

| Entity | Prefix | Code source | Link text shows |
|---|---|---|---|
| Job Card | `JC-####` | `job_cards.jc_no` (already minted via `nextNumber`) | the code |
| Work Order | `WO-####` | `work_orders.wo_no` (already minted) | the code |
| NCR | `NCR-####` | `ncr_records.ncr_no` (already minted) | the code |
| Material (BOM item) | `BM-{id}` | derived from `bom_items.id`, never stored | the code (description moved to tooltip) |
| Inventory item / stock piece / serial | `PL-…` / `LN-…` / `SR-…` / `INV-####` | delegates to `lib/data.js`'s `findInventoryItemIdByCode` | the code |
| Drawing | `DWG-{id}` | derived from `calc_drawings.id`, never stored | the drawing's real **name** — deliberately not the code, see Deferred §1 |
| GRN (goods receipt) | `INW-####` | `stock_receipts.inward_batch_no` — this app's actual name for a GRN is "receipt"/"inward batch", already minted via `nextNumber` | the code |
| Gate Inward Receipt (GIR) | `GIR-{n}` | derived from `gate_inward_receipts.gir_no`, a bare `INTEGER` — "GIR-" is display-only, same as `StoresWorkspace.jsx` already does | the code |
| Gate Pass | `GP-{n}` | derived from `gate_passes.gp_no`, a bare `INTEGER` — "GP-" is display-only, same as `StoresWorkspace.jsx` already does | the code |

Certificates are out of scope (their only clean unique key is a 3-part combo — `cert_no` +
`cast_no` + `plate_no` — not a single code).

**Now wired (later round)** — Purchase Requisition (`PR`), RFQ (`RFQ`), Fixed Asset (`FA`) as
stored-full-code tokens (`resolveJobCard` pattern, label = the real code). Purchase Order, Quotation,
Sale Order, Packing List, Credit Note, Debit Note as **derived-id** tokens (`PO`/`QT`/`SO`/`PK`/
`CN`/`DN` + numeric id, `resolveBomItem`/`idFrom` pattern) — required because their real business
numbers are slash-delimited (`579/SB/2026-27`, `QTN-42/SB/2026-27`, `SBE/CN/1/2026-27`) or
heterogeneous free text (`so_no`, half-minted), which `TOKEN_RE`'s hyphen-only grammar can't
represent; the synthetic token links, the label shows the real number. `PK-` deliberately distinct
from stock-piece `PL-` (same `packing_no` "PL-####" shape, different table — would have collided).
Same round also fixed the `so_no` half-mint: `POST /api/sale-orders` now mints `SO-{seq}` off the
shared `sale_order_no` counter instead of taking free text. `TOKEN_RE`'s character class was not
touched — only new prefixes added to its alternation, zero risk to any existing token. Verified live
against real inserted rows for all 8 (PR/RFQ/FA/PO/QT/SO/PK, cleaned up after) plus a regression
check that pre-existing prefixes (`PL`/`DG`/etc.) were untouched.

**Security fix, same round (audit pass, caught before it shipped to real users)** — 8 of these 9
entities have real department gates on their normal read paths (`/procurement`, `/sales`,
`/accounts`, `/packing` each redirect a wrong-department user home; their list/detail API routes
independently re-check too). `lib/entity-refs.js`'s resolve/search only ever checked `isInternal` —
so any internal user could see PO pricing/supplier, quotation totals/customer, fixed-asset cost, a
credit/debit note's amount via a tooltip, or **actively browse them by typing `@` and searching**
(`searchEntityRefs` had the identical gap — a true browse-by-typing side door, not just a passive
tooltip leak). Fixed: `user` is now threaded through `resolveEntityRef`/`resolveEntityRefs`/
`searchEntityRefs`, gated by two small maps (`READ_GATE`, `SEARCH_GATE`) that mirror each entity's
own existing department check exactly (Procurement / Sales-or-Marketing-or-PM / Accounts / Dispatch
/ Procurement-or-Stores for PO). A blocked code degrades to "absent from the result", same graceful
pattern as an unknown/typo'd code — never a hard 403 for one bad token in an otherwise-valid batch.
Sale Order confirmed as the one genuine exception (ungated elsewhere in the app too, left as-is).
Verified live in both directions: `design_head` (no Procurement/Accounts access) gets an empty
result from both resolve and search on `PO-`/`FA-` codes; `procurement_head`/`accounts_head`
resolve the same codes correctly.

Every resolved ref (except inventory items and, for now, drawings) shows its **code** as the link
text, not its name/description — the name lives in the tooltip instead. This was a deliberate
correction mid-session: `bom_item` originally showed the material description inline; changed to
show `BM-{id}` with the description moved into `detail.meta`, matching how `job_card`/`work_order`/
`ncr` already worked.

### API

`app/api/entity-refs/resolve/route.js` (batched code→ref lookup) and
`app/api/entity-refs/search/route.js` (per-type search, backs the `@` picker). Both
`isInternal`-only, no department/project scoping — **verified, not assumed**:
`getProjectsWithStatus()` (`app/projects/page.js:17`) has no per-department filter, every internal
role sees every active project, and `canAccessDepartment` gates *actions* (raising a task at a
department) never *reads*. Scoping the resolver by department would invent a restriction that
doesn't exist anywhere else in this app.

### Rendering — `components/LinkifiedText.jsx` (new)

Splits text on `lib/entity-ref-tokens.js`'s token regex, renders resolved tokens as a `<Link>`
wrapped in a `Tooltip` (shadcn/radix, `components/ui/tooltip.jsx` — global `TooltipProvider`
already mounted in `app/layout.js`, no new provider needed), unresolved tokens as plain text
(typo'd/deleted entity — degrades like a typo'd GitHub `#123`, never throws). Resolution is
batched **once per component instance** (once per `TicketsPanel`, once per `DrawingCard`'s comment
thread), not once per row, to avoid an N+1 fetch.

Tooltip content: one generic renderer reads each type's `detail: {status, meta}` (same
declarative-over-bespoke idiom `MasterWorkTable.jsx`'s `columns.kind` uses). **No color-coding by
entity type** — explicitly rejected by the user: too many types for distinct colors to stay
legible, and color already means BOM *purchase stage* elsewhere via `STAGE_BAR_COLORS` in
`lib/bom-fields.mjs` — a second meaning on the same channel would clash, not clarify. Type is
disambiguated by the tooltip's own type-label line instead.

### Inline `@` mention trigger — `components/MentionTextarea.jsx` (new)

Wraps the Details `Textarea` in `RaiseDialog`. Typing `@` with no whitespace back to the cursor
opens a dropdown: bare `@` shows a **type picker first** (chips: Material/Job Card/Work
Order/Drawing/NCR — not a blended list, per user's explicit choice), picking a type switches to a
live-searched result list (`/api/entity-refs/search?type=...`, 250ms debounce) filtered by
whatever's typed after `@`. Selecting a result replaces the whole `@query` span with the code + a
trailing space. Basic keyboard nav (arrows/Enter/Escape). Dropdown is anchored below the textarea,
not pixel-positioned at the caret (deliberate — caret-coordinate math in a 2-row textarea isn't
worth the complexity).

**This fully replaced** the earlier button-triggered `EntityRefPicker.jsx` dialog, which is
deleted — one way to insert a reference, not two, per the user's explicit choice.

`components/ui/textarea.jsx` was changed to `React.forwardRef` — it wasn't before, which silently
broke `MentionTextarea`'s caret-repositioning (`ref.current` was always `undefined`). Backward
compatible, no other call site is affected.

### Drawing comments also tag — `CalcWorkspace.jsx` only, not the customer portal

`calc_drawing_comments.body` is the one other free-text field in the app that's both real (written
by staff) and actually displayed (checked every other candidate — see Deferred §2 below, all ruled
out as dead/never-rendered fields). Wired into `components/CalcWorkspace.jsx`'s `DrawingCard`
exactly like `TicketsPanel.jsx` (batched resolve per comment thread, `LinkifiedText` render).

**Deliberately NOT wired into `components/PortalOrderProgress.jsx`** (the customer-facing version
of the same comment thread) — `/api/entity-refs/resolve` is `isInternal`-only, so a customer's
resolve call always 403s and yields nothing. Tagging there would render the *exact same plain
text* a customer already sees, just after a network round-trip that can never succeed — pure
waste, not a feature. (This was wired in briefly, then reverted after being flagged mid-session as
scope creep with no payoff for that audience — the file is untouched from its pre-session state.)

## Browser verification performed this session

All of the following were actually exercised in the running app (`shanti-ops-calc` preview,
project SB-1040, the only seeded project), not just code-reviewed:

1. **Task tagging** (`production_head`): raised a task referencing `BM-1719` (real) and
   `JC-9999`/`BM-999999` (fake). The real one resolved, rendered as compact "BM-1719" link text,
   linked to `/projects/50`, and its tooltip showed "Material / In-Stock / Material: Angle
   bolts... / Qty: — / Project: SB-1040". The fake ones degraded to plain text, no console error.
2. **`@` mention trigger** (`production_head`): typing bare `@` opened the 5 type chips instantly;
   picking "Material" showed a live-searched list of real `BM-####` rows with project numbers;
   selecting one replaced `@` with `BM-1717 ` (code + trailing space) at the cursor correctly.
3. **Drawing comments** (`design_head`): created a real calc sheet + drawing on SB-1040 (none
   existed yet — "Tagging Test Sheet" / "GA Drawing Test"), posted a comment "Waiting on BM-1719
   and JC-9999 before proceeding." — `BM-1719` linked with the same tooltip as above, `JC-9999`
   stayed plain. (One harmless observation: the resolve fetch fires after the comment-list state
   update, so the very first paint after posting can briefly show text unlinked for a few hundred
   ms until that second render — same batched-resolve tradeoff every consumer of this pattern has,
   not a bug.)
4. **Customer portal** (`components/PortalOrderProgress.jsx`) confirmed to render cleanly
   untouched — no comment-tagging wiring there, per the "deliberately not wired" decision above.
5. **GRN / GIR / Gate Pass** (`stores_head`): confirmed real data exists and resolves correctly —
   `GET /api/entity-refs/resolve?codes=GIR-1004` returned `{status:"closed", meta:[Vehicle:
   TN37BZ5588, Supplier: JR SEAMLESS PVT LTD]}`; `INW-1001` and `GP-1008` resolved with correct
   supplier/type/party data. The `@` picker's type-chip list (now 8 entries, scrollable) showed
   "GRN" and "Gate Inward (GIR)"; picking GIR live-searched and returned the two real seeded
   records ("GIR-1004 · TN37BZ5588", "GIR-1003 · MH14GH2211"). **Full render also confirmed**
   (initially only API-checked, later closed the gap — see "Gaps reviewed" below): raised a real
   task with `Received gir-1004, gate pass GP-1008, and grn INW-1001. Fake GIR-9999 too.` —
   `GIR-1004` and `GP-1008` rendered as blue links to `/stores?tab=gir`/`/stores?tab=gatepasses`;
   `INW-1001` rendered bold (no link, correct — GRN has no detail page) but still tooltip-enabled;
   `GIR-9999` (fake) degraded to plain text. Hovering `GIR-1004` showed "Gate Inward (GIR) / Closed
   / Vehicle: TN37BZ5588 / Supplier: JR SEAMLESS PVT LTD".

One transient, unrelated thing seen in server logs during rapid `@`-search typing: a single `500` +
`TypeError: fetch failed ECONNREFUSED` — Turso's remote DB having a momentary network blip
(`connect ECONNREFUSED 13.207.22.218:443`), not a bug in this feature's code. Self-resolved on
retry.

## Gaps reviewed after the feature was "done" — what was found, what got fixed

Asked explicitly to gap-check the finished feature. Five things came up; two got fixed, one is a
documented accepted risk, two were already-known and already documented above/below.

1. **Fixed — case sensitivity.** The token regex had no `i` flag, so `bm-88` or `gir-1004` typed
   in lowercase silently failed to link (degraded to plain text, no crash, but a real gap since
   people don't always type in caps). Fixed in two places, deliberately not just one:
   `lib/entity-ref-tokens.js`'s `TOKEN_RE` now has the `i` flag (matches lowercase/mixed-case
   tokens, but still returns the *original-case substring* — needed to split the source text
   correctly); `lib/entity-refs.js`'s `resolveEntityRef` normalizes to uppercase once, internally,
   before querying (every stored code is minted uppercase) — but `resolveEntityRefs`' returned map
   is still keyed by the *original* requested code, so `LinkifiedText`'s `refs[part]` lookup (which
   uses the original-case substring found in the text) still matches. Verified live: `GET
   /api/entity-refs/resolve?codes=bm-1719,gir-1004,Gp-1008` all three resolved; typing
   `gir-1004`/`GP-1008` (mixed case) into a real task body rendered as `GIR-1004`/`GP-1008` links
   (normalized on display, matching every other entity's `label: full` convention) with working
   tooltips.
2. **Accepted risk, not fixed — `GP-` is a plausible false-positive prefix.** "GP" is common
   shorthand for galvanized-plain sheet in Indian steel terminology; a material description or
   comment saying "GP-2mm sheet" would attempt to resolve as Gate Pass #2. Low risk in practice —
   `gp_no` values start at 1000+ via the shared counter, so a coincidental 4-digit collision is
   unlikely, and grepping this codebase's actual data found no "GP" grade usage — but it's a real,
   unproven assumption, not a guaranteed-safe one. No clean fix without either hurting true
   positives (e.g. requiring more digits) or adding a discovery/disambiguation step that doesn't
   exist anywhere else in this feature; left as-is, documented here so it's a known tradeoff, not a
   surprise.
3. **Closed — full render verification for GRN/GIR/Gate Pass.** Originally only checked via direct
   API calls and the `@` picker's dropdown, not by actually posting a real tagged comment/task and
   watching it render + hover. Same code path as `BM-`/`JC-` (already fully verified), so this was
   always more "should work" than "unverified" — but now it's actually verified too (see item 5
   above).
4. **Already known — `PL-` is a shared, ambiguous prefix in this app's own numbering.** Stock
   pieces use `PL-0007`; Packing Lists separately use `PL-####` in a different table. The registry
   only supports one resolver per prefix, so Packing Lists can't reuse `PL-` if wired in later —
   flagged in the registry table above and in Deferred §3.
5. **Already known — deep-link precision.** Every link lands on a workspace page, never the exact
   record (see "Deep links" section below and Deferred §3). Most visible gap of everything shipped,
   already fully documented, not new.
6. **Fixed — `LN-` (length/linear stock pieces) was completely missing from the token registry.**
   `lib/stock-pieces.js`'s `rootCode()` generates `PL-####` for plate-kind stock and `LN-####` for
   everything else (round bar, pipe, structural sections) — confirmed real and actively used by
   `StoresWorkspace.jsx`'s own search placeholder ("a PL-/LN-/SR-/IM- code"). Only `PL-` had been
   added to `lib/entity-ref-tokens.js`'s `TOKEN_RE` and `lib/entity-refs.js`'s `REFS` map — `LN-`
   codes weren't unresolved, they were **never even recognized as tokens in the first place**, a
   different and worse failure mode than everything else in this feature (no graceful-degrade
   plain-text fallback applies to a token that's never detected at all). Fixed: added `LN` to both
   the regex alternation and the registry (routes to the same `resolveInventoryCode`/
   `findInventoryItemIdByCode` `PL-` already used — that function is prefix-agnostic, it just does
   an exact `stock_pieces.code = ?` match). Verified the regex now matches the real hyphenated
   format (`LN-0007-U1`) and the endpoint resolves without error; **not** verified against a real
   linear-stock piece end-to-end — this seed database has no linear/length stock data, only plate
   and generic inventory items, so there was nothing real to tag and click through. The code path
   is identical to the already-proven `PL-` mechanism, but that's "should work," not "verified
   working" — worth a real check next time linear stock exists in test data. `IM-` (catalog item
   code, also named in that same placeholder) was deliberately *not* added — traced back to
   `items.item_code`, which an earlier research pass in this session found to be import-only and
   almost entirely unpopulated (1 of 2,773 rows) — not a real, live key worth wiring up.
7. **Fixed — silent text truncation on render for derived-id codes with a stray extra hyphen.**
   The most serious gap found across all these passes, and a genuinely different failure mode from
   everything above (those degrade *safely* to plain text; this one silently *changed* text). The
   token regex allows multiple hyphenated segments per code — added deliberately for stock-piece
   suffixes (`PL-0007-U1`) — but that grammar is shared globally across every prefix, including the
   four derived-id types (`BM`/`DWG`/`GIR`/`GP`) that never legitimately have more than one hyphen.
   Their shared `idFrom()` helper did `full.split('-')[1]`, silently ignoring anything after the
   second segment: a stray `BM-88-old` in someone's free text would still extract id `88`, resolve
   successfully, and `LinkifiedText` would replace the *entire* matched `BM-88-old` substring with
   just the resolved label `BM-88` on render — dropping "-old" with zero indication anything had
   changed. Fixed: `idFrom()` now requires exactly two hyphen-separated segments (prefix + number);
   anything longer returns `null`, so an over-long code fails to resolve and renders as its own
   original, untouched text — the same safe degrade every other unresolved token already gets.
   Verified live: `GET /api/entity-refs/resolve?codes=BM-1719-old,BM-1719,GIR-1004-x,GIR-1004`
   returned only the two clean codes; the two with a stray suffix are correctly absent.

## Deep links — what clicking a rendered reference actually does

Every `href` in `lib/entity-refs.js` goes to the closest page that exists, never to a record that
doesn't have its own page — because **no entity in this app has a per-record URL today**. A job
card, drawing, GIR, or gate pass is always a row/panel inside a bigger workspace page, not its own
route. So a click always means "jump to the right *screen*," never "jump to the right *row on that
screen*." This is a pre-existing limitation of the app, not something this feature introduced —
`TicketsPanel.jsx`'s original project links had the exact same shape.

| Entity | Clicking goes to | Lands on the exact record? |
|---|---|---|
| Job Card, Work Order, NCR, Material, Drawing | `/projects/{project_id}` | No — project page only |
| Inventory item | *(no link — plain text)* | — no page exists for a single item |
| GRN | *(no link — plain text)* | — no GRN detail page exists anywhere yet |
| GIR | `/stores?tab=gir` | No — lands on the tab, not scrolled to the row |
| Gate Pass | `/stores?tab=gatepasses` | No — lands on the tab, not scrolled to the row |

## Deferred — three follow-ups, explicitly not done in this pass, each needs its own planning/scoping

### 1. Real, stored drawing (and calc sheet) numbers — RESOLVED, see `drawing-numbering-changes.md`

Picked up in a later round: `DG-`/`CS-` shipped, wired through every infrastructure surface (mint,
schema, backfill, display, reports, entity-ref tagging), plus a QC canonical-drawing-number half
that wasn't scoped here originally (found while verifying the wiring against SYSTEM.md). Mint/
schema/backfill and display were browser-verified live; the QC half was implemented but not yet
click-through verified — see that doc's "Not yet verified" section before assuming it works.

Original framing kept below for history.

Currently `calc_drawings` has no human code (only `name`, an existing 2026-08-19 codebase decision
at `lib/db.js:1979-1983` deliberately rejected adding one — "the exact duplicate-concept this
round was told to avoid"). Calc sheets (`app/calc/project/[projectId]/[sheetId]`) have no code
either, only a numeric id in the URL.

**The user wants to reverse that decision**: real, permanent, stored numbers for both — drawings
prefixed `DG-` (not `DWG-`, which was only ever this feature's internal, unstored reference token),
and calc sheets need the equivalent treatment. This is explicitly a bigger change than tagging: a
new minted column each (`nextNumber('drawing_no', 'DG')` etc., same idiom as `wo_no`/`jc_no`), a
backfill migration for existing rows (same shape as `lib/db.js`'s `job_cards_jc_no_v1`), and
surfacing the number everywhere each entity is shown across the Design module (`CalcWorkspace.jsx`,
drawing/calc-sheet lists, customer portal if applicable) — not just inside this tagging feature.

**User's explicit instruction: defer this, do the rest of the tagging feature completely first.**
That's now done (see above). When this is picked up: start a fresh planning session (not a quick
patch) — open questions are the exact numbering format for each, backfill behavior, and every UI
surface that needs to switch from showing `name`/raw id to showing the number. Once real codes
exist, `lib/entity-refs.js`'s `resolveDrawing` should flip to show the code as link text + name in
the tooltip, same as every other entity type already does.

### 2. Expand tagging to other free-text surfaces

Checked every candidate by grepping for where each field is actually *read and rendered* (not just
written) — tagging a field nobody ever looks at again is no benefit:

- `milestones.reopen_reason` (`app/api/milestones/[id]/reopen/route.js:43`) — stored, but **never
  displayed anywhere** in `components/`/`app/`. Not a candidate until something renders it first —
  a separate, unrelated gap.
- `job_cards.notes` — same story, never rendered in `JobCardBoard.jsx` or anywhere else.
- `ncr_records.disposition_notes` — written on disposition, never read back/displayed in
  `NcrPanel.jsx` or anywhere else.
- `calc_drawing_comments.body` — **was** a real candidate, now shipped (see above).
- Not checked yet: whether `components/ProductionToday.jsx`'s own-department Tasks-tab composer
  shares `tasks.body` display with `TicketsPanel.jsx` (same table) or needs its own `LinkifiedText`
  wiring — worth a quick look before assuming it's covered.

No other genuine candidates found this session. If the user wants tagging somewhere else, the
pattern to follow is exactly what `CalcWorkspace.jsx` does: import `LinkifiedText`, add a
batched-resolve `useEffect` keyed on whatever list holds the free text, render the field through
`LinkifiedText` with the resolved `refs` map.

### 3. Tighter deep-links (scroll/highlight the exact record)

Not started. See "Deep links" section above for the full table of what clicking each entity type
does today (always the closest existing page, never the exact record — no entity in this app has
a per-record URL yet). Would need each target page (`/projects/[id]`, `/stores`) to read a query
param (e.g. `?highlight=GIR-1004`) and scroll to + visually flash that specific row/panel — none
do this today. Small, mechanical, but touches several pages' worth of scroll-into-view logic; a
reasonable candidate to bundle with whichever future pass gives entities their own per-record
pages (if that ever happens) rather than duct-taping query-param highlighting onto today's
list-only pages. **Status: still not started as of this writing — next planned pickup, alongside
defining explicit relationships between these entities (many-to-one, one-to-many, many-to-many,
subset-of, etc. — e.g. a BOM item belongs to one drawing, a PO can span multiple PR line items).**
The earlier "7 more entities" note here is now stale — all 20 entities with real minted codes are
wired into tagging (see the tally above); this section is purely about deep-link precision now.

### 4. `ENTITY_TYPES` chip list isn't filtered per department (cosmetic, deliberately not fixed)

The `@`-picker shows all type chips (Purchase Order, Quotation, etc.) to every internal user
regardless of department, even though `searchEntityRefs`' `SEARCH_GATE` (see above) now makes a
blocked type silently return zero results. Not a security issue — the actual data access is
already blocked — just a UX rough edge (a Design user can tap the "Purchase Order" chip and always
get nothing). Real fix means converting `MentionTextarea.jsx`'s hardcoded client-side `ENTITY_TYPES`
array into a server-fetched, per-user-filtered list. **Explicitly deferred — user confirmed this is
low priority, not worth the effort right now.**

### 5. Short-prefix false-positive risk — accepted, not "fixed" (same conclusion as the original `GP-` case)

Every 2-3 letter derived-id prefix (`GP`, and now `SO`/`CN`/`DN`/`PR`/`PO`/`FA`/`QT`/`RFQ`/`PK`) can
coincidentally appear in real prose followed by a hyphen and digits — e.g. a material spec reading
"GP-2mm sheet" (GP = galvanized-plain, common steel terminology, nothing to do with a Gate Pass).
**The derived-id prefixes added in the later round are actually a *larger* version of this same
risk than the original `GP-`/`GIR-` case**: `GP-`/`GIR-` mint off `nextCounterValue(name)` with the
default `startAt=1000`, so real codes only exist in the 1000+ range — small coincidental numbers in
prose (`GP-2`) essentially never collide with a real row. `PO-`/`QT-`/`SO-`/`PK-`/`CN-`/`DN-`,
though, are derived straight from the table's own `AUTOINCREMENT id` (via `idFrom`), which starts
at **1** — so a coincidental low number in unrelated prose (someone typing "PO-5" meaning something
else entirely) has a real chance of matching an actual row and producing a wrong-but-harmless link.

**Why this doesn't have a clean fix, same as the original `GP-` investigation concluded:** the two
only-real options both cost something —
1. **Require more digits / a higher minimum id** before a derived token resolves — directly hurts
   true positives (a real `PO-5` stops working, forever, even once the business has issued
   thousands of POs and "5" is a perfectly normal id).
2. **Add a discovery/disambiguation UI** (e.g. a confirm-before-link step, or visually distinguish
   "resolved with low confidence") — a mechanism that doesn't exist anywhere else in this feature;
   adding it only for these prefixes would be inconsistent, and building it generally is a real,
   separate UI project, not a small fix.
Every resolve is **read-only and now department-gated** (see the security fix above) — the actual
damage ceiling of a false-positive match is "a tooltip shows the wrong record's status to someone
already allowed to see that record type," never data corruption, never a wrong write, never an
access-control bypass. **Recommendation: leave as accepted risk, same as `GP-`** — unless a future
round wants to invest in a real confidence/disambiguation UI, which is a bigger, separate project
worth scoping on its own, not a quick patch to this file.

### 6. `items.item_code` / `IM-` — not a tagging gap, a data-completeness gap in a different part of the app

Traced back in the original round: `items.item_code` (the **catalog** item's own code — distinct
from `inventory_items`/`stock_pieces`, which already tag fine via `INV-`/`PL-`/`LN-`/`SR-`) is
populated on roughly **1 of 2,773 rows** — everything else is blank, because it's only ever written
by an import path, never by hand in the UI. There is no reliable key here to tag *by* — adding an
`IM-` resolver today would resolve for one catalog item and silently fail for the other 2,772.
**This isn't something the tagging system can fix** — the actual gap is that catalog items don't
get a real code at creation time anywhere in the app, which is a data-governance/catalog-ownership
question for a completely different part of the codebase (wherever `items` rows get created),
unrelated to `lib/entity-refs.js`. Wiring `IM-` into tagging only becomes worthwhile *after* that
gap is closed elsewhere — same shape as the `DG-`/`CS-` round, which had to fix the *source* column
before tagging could show anything real.

## Files (current state)

**New:** `lib/entity-refs.js`, `lib/entity-ref-tokens.js`, `components/LinkifiedText.jsx`,
`components/MentionTextarea.jsx`, `app/api/entity-refs/resolve/route.js`,
`app/api/entity-refs/search/route.js`.

**Modified:** `lib/db.js` (tasks.body column), `app/api/production/tasks/route.js` (accept/insert
body), `components/TicketsPanel.jsx` (send body, render `LinkifiedText`, mount
`MentionTextarea`), `components/WorkersPanel.jsx` (jc_no display fix), `components/ui/textarea.jsx`
(forwardRef), `components/CalcWorkspace.jsx` (drawing comments now tag).

**Deleted:** `components/EntityRefPicker.jsx` (superseded by `MentionTextarea.jsx`).

**Untouched, despite being edited and reverted mid-session:** `components/PortalOrderProgress.jsx`
— see "Drawing comments" section above for why.

**Unrelated, pre-existing, not touched by this work:** `components/QcDocumentEditor.jsx` shows
modified in `git status` from before this session started — not part of this feature.
