# Entity-ID tagging in incident/task free text

Companion doc to `operations-tab-changes.md` (same "decision log kept as historical record"
precedent as `PROCUREMENT-CHANGES.md`/`STORES-SALES-CHANGES.md`). Written mid-build so a fresh
chat can pick this up without re-deriving context.

## What this is

Lets someone raising an incident/task (`TicketsPanel.jsx`'s `RaiseDialog`), or commenting on a
drawing (`CalcWorkspace.jsx`), reference another entity — a material (BOM line), job card, work
order, drawing, or NCR — by a short code, and have that reference render as a clickable link with
a hover tooltip showing that entity's current status, instead of sitting as dead free text.

## Status: fully shipped, two rounds

Round 1 (below) was browser-verified. **Round 2** (deep-links + explicit relationships, see its own
section below) is build-verified (clean `npm run build`, zero errors/warnings) but not yet
browser-verified — see its own manual checklist. Of the original three deferred follow-ups: real
drawing/calc-sheet numbers were resolved earlier in `drawing-numbering-changes.md`; tighter
deep-links and the explicit-relationships ask are resolved in Round 2; expanding tagging to other
free-text surfaces was investigated and answered (Part D of Round 2) rather than needing new code.

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

**Round 2 added two more derived-id tokens: `SI` (Sales Invoice) and `VB` (Vendor Bill)** — see
"Round 2" below for why (they're the real link target of several structural relationships built in
that round). Same shape, same reasoning as PO/QT/SO/PK/CN/DN above.

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

**RESOLVED, see "Round 2" below.** The paragraph and table immediately following describe the
*original* shipped state (every link landing on a whole workspace page, no `?highlight=`
mechanism) — kept for history. Every `href` now appends `?highlight=CODE`, and the target page
either scrolls-and-flashes the exact row or (Job Card/Work Order/Purchase Order) opens the
record's own detail view directly. Several hrefs were also corrected to point at the page that
actually renders the record (Job Card/Work Order → `/production/workers`, NCR → `/qc`) instead of
the project page, which never actually mounted those lists.

Every `href` in `lib/entity-refs.js` went to the closest page that exists, never to a record that
doesn't have its own page — because **no entity in this app has a per-record URL** (still true
today for everything except `calc_sheet` and `packing_list`). A job card, drawing, GIR, or gate
pass is always a row/panel inside a bigger workspace page, not its own route. So a click used to
always mean "jump to the right *screen*," never "jump to the right *row on that screen*." This was
a pre-existing limitation of the app, not something this feature introduced — `TicketsPanel.jsx`'s
original project links had the exact same shape.

| Entity | Clicking went to (original) | Lands on the exact record? |
|---|---|---|
| Job Card, Work Order, NCR, Material, Drawing | `/projects/{project_id}` | No — project page only |
| Inventory item | *(no link — plain text)* | — no page exists for a single item |
| GRN | *(no link — plain text)* | — no GRN detail page exists anywhere yet |
| GIR | `/stores?tab=gir` | No — lands on the tab, not scrolled to the row |
| Gate Pass | `/stores?tab=gatepasses` | No — lands on the tab, not scrolled to the row |

See "Round 2 — tighter deep-links + explicit relationships" below for the corrected table.

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

### 3. Tighter deep-links (scroll/highlight the exact record) — RESOLVED, see "Round 2" below

Built: `?highlight=CODE` on every href, a shared `useEntityHighlight()` hook that scrolls+flashes
the matching `data-entity-code` row, and a click-to-open-detail variant for Job Card/Work
Order/Purchase Order (whose lists are click-through-to-a-Sheet UIs, not inline tables). Several
hrefs were also corrected to point at the page that actually renders the list. Explicit
relationships between entities (Part A of the same round) were built alongside this, since both
turned out to reuse the same registry. See "Round 2 — tighter deep-links + explicit relationships"
below for the full design and the real bugs found while implementing it.

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

## Round 2 — tighter deep-links + explicit relationships (2026-08-29)

Picked up Deferred §3 in full, plus the "explicit relationships between entity IDs" ask that came
with it. Planned in a dedicated plan-mode session (schema fully re-read against `lib/db.js` for
every one of the 20 tagged tables plus their neighbors — `pr_items`, `pr_item_projects`,
`rfq_items`, `po_items`, `packing_items`, `work_order_materials`, `stock_receipts`,
`stock_pieces`, `sales_invoices`, `vendor_bills`) before any code was touched, then implemented and
self-audited in the same session (two review passes; see "Bugs found" below — this is not a
"shipped and hoped" round, every relation was checked against what the resolver on the other end
actually expects).

### Part A — explicit relationships ("Related" panel)

**Conclusion going in, confirmed by the schema read: the relationships mostly already existed as
real FK columns and junction tables — this was a rendering gap, not a data-modeling one.**
`JobCardBoard.jsx` printed raw `BOM item #{id}` text; `NcrPanel.jsx` never showed its own
`job_card_id`/`work_order_id`/`bom_item_id`/`stock_piece_id` at all, only used them internally to
gate the disposition dropdown.

- **`lib/entity-refs.js` gained a `RELATIONS` registry** — ~40 real FK/junction relationships
  across 15 entity types, one small hand-written SQL query per relation (this codebase's existing
  "one query per real case" idiom, not a generic FK-graph walker). `getRelatedEntities(type, id,
  user)` runs a type's relations, collects the codes each one emits, and batch-resolves them
  through the **existing** `resolveEntityRefs()` — department gating and graceful-degrade-on-missing
  come for free, and recursion is naturally bounded to one hop (a related ref is never itself asked
  for ITS relations). New route: `GET /api/entity-refs/related?type=&id=`.
- **Deliberately NOT modeled**: `CS` (calc sheet — no cross-entity FK), `FA` (fixed asset — none),
  `GP` (gate pass — no FK columns at all), `PR`/`RFQ` outgoing-to-nowhere cases, and — found while
  implementing, not planned in advance — **`inventory_item`'s own outgoing relations**:
  `findInventoryItemIdByCode()` (`lib/data.js`) deliberately collapses every `PL-`/`LN-`/`SR-`/
  `INV-` code down to the shared `inventory_items.id`, discarding which specific `stock_pieces` row
  a `PL-`/`LN-` code actually named — so there is no way to ask "this resolved inventory item's own
  receipt/job-card" without that lost specificity. The *reverse* direction (another entity's
  relation pointing AT a stock piece by its own code — NCR's "Stock piece" relation) is unaffected,
  since that only ever emits a fresh code for the normal resolve path. Stock-piece **lineage**
  (`parent_id` cut/remnant/scrap chains) already has its own dedicated UI, `components/
  PieceLineage.jsx` — reused as-is, not duplicated inside the new Related panel.
- **Two new entity types added: `SI` (Sales Invoice) and `VB` (Vendor Bill).** Neither had a tag
  before this round, but both are the real link target of several relations being built (PO→Vendor
  Bills, Packing List→Invoice, Sale Order→Invoices, Credit/Debit Note→"against") — without them,
  half that relation graph would have had nowhere to link *to*. Same derived-id shape as `PO`/`QT`
  (`invoice_no`/`bill_no` aren't hyphen-safe or unique). Confirmed with the user before building
  (a real scope decision, not silently expanded).
- **`components/EntityRefLink.jsx` (new)** — `RefTooltip` extracted out of `LinkifiedText.jsx` so
  both the free-text linkifier and the new structural-relations panel render an identical
  Link+Tooltip, not two visual languages. Also exports `EntityCode` — a tiny self-resolving
  component for a spot that only has a raw FK id in hand (e.g. a `materialIssue` row's bare
  `bom_item_id`) and would otherwise need to duplicate href-construction rules that already live in
  `lib/entity-refs.js`.
- **`components/RelatedItemsCard.jsx` (new)** — fetches `/api/entity-refs/related` once per
  `(type, id)`, renders each relation as a labeled row of `EntityRefLink` chips, and renders nothing
  at all if there's nothing to show (same "degrade to nothing" convention as an unresolved token).
  Wired into `NcrPanel.jsx` (every NCR row — the highest-value target, since it previously showed
  none of its own links), `JobCardBoard.jsx`'s detail Sheet (also fixed the raw `BOM item #{id}`
  line via `EntityCode`), `WorkOrdersPanel.jsx`'s detail Sheet (the one new relation it didn't
  already show inline — NCRs), and `PackingDetail.jsx` (its Invoice No. field was plain text even
  when linked; now a real `EntityCode` link once `sales_invoice_id` is set).

### Part B — tighter deep-links (`?highlight=CODE`)

- **Convention**: the exact same code string already used for tagging (`JC-1004`, `BM-88`, ...) as
  the `?highlight=` value — one format across the whole feature.
- **Two behaviors depending on the target UI shape**, decided per entity, not forced uniform:
  - **Click-to-open detail** (Job Card, Work Order, Purchase Order — all three are click-through-
    to-a-Sheet/drawer UIs, not inline tables): on load, if `highlight` matches a loaded row's code,
    the same open-handler a click would call fires automatically. No CSS involved — the
    Sheet/drawer opening *is* the highlight.
  - **Inline list row** (NCR register, BOM table, Drawing cards, GIR/Gate Pass tables, PO/DN/QT/SO/
    SI/CN/FA tables): new shared hook `lib/use-entity-highlight.js`'s `useEntityHighlight(code)` —
    `document.querySelector('[data-entity-code="..."]')`, `scrollIntoView`, a brief
    `.entity-highlight-flash` CSS class (new keyframe in `app/globals.css`, `color-mix()` fade
    against the existing `--primary` token so it's theme-correct for free). Retries for ~1.5s (a
    tab switch or one client fetch can land after the first paint), then silently gives up — same
    graceful-degrade philosophy as an unresolved tag in free text, never an error.
- **Several hrefs corrected, not just extended with a query param.** Job Card, Work Order, and NCR
  never actually rendered inside the project page's `DepartmentPanel` at all (confirmed by reading
  `components/DepartmentPanel.jsx` — it never mounts `JobCardBoard`/`WorkOrdersPanel`/`NcrPanel`).
  Job Card/Work Order live at `/production/workers` (`WorkersPanel.jsx`'s `jobcards`/`workorders`
  tabs); NCR lives at `/qc` (`QcWorkspace.jsx`'s `ncr` tab, cross-project, no per-project filter to
  also set).

  | Entity | Corrected href |
  |---|---|
  | JC | `/production/workers?tab=jobcards&highlight=JC-1004` (opens the card's Sheet) |
  | WO | `/production/workers?tab=workorders&highlight=WO-12` (opens the WO drawer) |
  | NCR | `/qc?tab=ncr&highlight=NCR-3` |
  | BM | `/projects/{project_id}?dept=Engineering&highlight=BM-88` |
  | DG | `/projects/{project_id}?dept=Design&highlight=DG-1002` |
  | GIR | `/stores?tab=gir&highlight=GIR-1004` |
  | GP | `/stores?tab=gatepasses&highlight=GP-1008` |
  | PO | `/procurement?tab=orders&highlight=PO-42` (opens the PO drawer) |
  | DN | `/procurement?tab=vendor_bills&highlight=DN-5` (renders inside Vendor Bills, not its own tab) |
  | VB (new) | `/procurement?tab=vendor_bills&highlight=VB-8` |
  | QT | `/sales?tab=quotations&highlight=QT-42` |
  | SO | `/sales?tab=sale_orders&highlight=SO-9` |
  | SI (new) | `/sales?tab=invoices&highlight=SI-13` |
  | CN | `/sales?tab=invoices&highlight=CN-2` (renders inside Invoices, not its own tab) |
  | FA | `/accounts?tab=fixed-assets&highlight=FA-1001` |
  | PK, CS | unchanged — already real per-record pages |
  | PR | unchanged, `/pr`, no highlight — **verified `PrWorkspace.jsx` has no PR register/list tab at
        all** (its tabs are `raise`/`release`/`templates`, composers only), so there's genuinely
        nowhere to scroll to. An earlier draft of this round assumed a `requests` tab existed there;
        it doesn't — corrected before shipping. |
  | RFQ, INW | unchanged, no link — no list page exists for either yet |
- **`?dept=`/`?tab=` now actually work.** Before this round, `/stores?tab=gir` and friends were
  **dead query strings** — no tab-bearing workspace page except `/qc` (`initialTab`/`initialProject`
  server props) and `/production/workers` (`WorkersPanel.jsx`'s own `useSearchParams()`) read any
  URL state into their tab selection at all. Added the same `initialTab` server-prop pattern to
  `StoresWorkspace`, `ProcurementWorkspace`, `SalesWorkspace`, `AccountsWorkspace` (each seeded via
  their `page.js`'s `searchParams.tab`), and gave `ProjectDepartmentTabs.jsx` (the PM/admin
  all-departments picker) a `useSearchParams().get('dept')` read directly — a client component
  nested anywhere under a dynamic page can do this without threading a prop through
  `app/projects/[id]/page.js`, so that page itself needed no change for `?dept=`.

### Part D — "does tagging work for every department's task Description?" (user question, checked)

Traced `TicketsPanel.jsx`'s Raise dialog: it's **one shared component**, mounted identically by
`DepartmentPanel.jsx` for every department except Procurement (which gets the same component twice
more, on its own Requests tab and on Operations, filtered by `from_department`) — not a
per-department reimplementation. Tagging already worked identically everywhere by construction; no
code change was needed. **One real, pre-existing exception found**: the dialog's "Send back
(rework)" kind folds the Details text into `milestones.reopen_reason` instead of `tasks.body`, and
`reopen_reason` is never rendered anywhere in the app (already documented in Deferred §2 above) — a
tag typed there is stored correctly but invisible everywhere, not a tagging bug. Left as a known,
named gap rather than silently building a new display surface for it.

### Bugs found — two audit passes before calling this done

**Pass 1 (during implementation), found via careful re-reading of the RELATIONS table against
what each resolver actually expects — not caught by the syntax checker, which can't know a query
selects the wrong column:**
1. `job_card`'s "Work Order" relation selected the raw `work_order_id` FK integer and ran it
   through `raw` (meaning "already a full stored code") — but `work_orders`' stored code is
   `wo_no`, a separately-minted value, not the row's own id. Fixed with a join to select `wo_no`.
2. `bom_item`'s "Work Orders" relation and (3) `sale_order`'s "Work Orders" relation both made the
   opposite mistake — selected `work_orders.id` and ran it through `derived('WO')` (meaning "this
   type only ever gets a synthetic `{PREFIX}-{id}` code"), but WO is a **stored-code** type. Both
   fixed to select `wo_no` via `raw`, with a join where needed.
4. `grn`'s "Gate Inward Receipt" relation selected `stock_receipts.gate_inward_receipt_id` (which
   stores `gate_inward_receipts.id`) and ran it through `derived('GIR')` — but GIR codes are keyed
   by the separate `gir_no` column, not `id` (confirmed: `resolveGir`'s `idFrom()` match is against
   `gir_no`). Fixed with a join to select `gir_no`.

All four are the same class of mistake — confusing "stored-code" entities (JC/WO/NCR/DG/PR/RFQ/INW,
whose own `xxx_no` column IS the tag) with "derived-id" entities (BM/PO/QT/SO/PK/CN/DN/SI/VB/GIR/GP,
whose tag is a synthetic `{PREFIX}-{row.id}` never written to the DB) — worth remembering as a
category error to check for specifically if this registry grows further.

**Pass 2 (gap audit, prompted by direct question after the round was reported "done"):**
5. **`components/MentionTextarea.jsx` had its own hardcoded, stale `ENTITY_TYPES` list — separate
   from `lib/entity-refs.js`'s real, exported one, and never kept in sync with it.** It stopped at
   8 entries from the original round (`job_card`/`work_order`/`bom_item`/`drawing`/`ncr`/`grn`/
   `gir`/`gate_pass`) and was never updated when `calc_sheet`, `purchase_requisition`, `rfq`,
   `purchase_order`, `quotation`, `sale_order`, `packing_list`, `fixed_asset`, `credit_note`,
   `debit_note` were added to the real registry in an earlier round, nor when `sales_invoice`/
   `vendor_bill` were added in this one. **This section's own Deferred §4 ("The @-picker shows all
   type chips... to every internal user") was itself wrong when it was written** — those extra
   types were fully resolvable/searchable via direct API calls and via typing a code by hand, but
   never actually offered as a pickable chip in the `@` mention UI, the primary way most people
   would discover them. Fixed at the root: `ENTITY_TYPES` moved into the pure `lib/entity-ref-
   tokens.js` module (client-safe, no DB imports) as the one shared source; `lib/entity-refs.js` now
   re-exports it instead of defining its own copy, and `MentionTextarea.jsx` imports it directly.
   Structurally can't drift again — there is only one array now, not two.

### Verified

`npm run lint` (this repo's dependency-free syntax checker) passes on all 554 JS/JSX files, and a
full `npm run build` completes clean with zero errors or warnings (all touched routes — `/stores`,
`/procurement`, `/sales`, `/accounts`, `/production/workers`, `/qc`, `/projects/[id]`, `/packing/
[id]` — compile). Not done: a live browser click-through (deliberately skipped this round, per
instruction, to avoid burning tokens on heavy verification) — see the bullet checklist below for
what a human should spot-check before trusting this fully.

**Manual verification checklist** (light, no browser automation):
- Open a real NCR/BOM item/PO with linked records → expect new clickable "Related" chips.
- `GET /api/entity-refs/resolve?codes=SI-1` → expect a real invoice number as `label`.
- `@`-mention picker → "Sales Invoice"/"Vendor Bill" (and the other 10 previously-invisible types)
  now appear as pickable chips.
- Click a `GIR-`/`JC-`/`BM-` reference → expect landing on the right tab with the row flashed (GIR/
  BM) or its detail Sheet already open (JC).
- Set a filter that would hide a highlight target, then click its link → expect either the row
  still shows or the flash silently no-ops — never a crash.
- Re-check 2–3 items from this doc's own earlier verification list still hold (case-insensitive
  `bm-88`, a fake `JC-9999` degrading to plain text, a Design-only user getting nothing for `PO-`/
  `FA-`).

## Files (current state)

**New (original round):** `lib/entity-refs.js`, `lib/entity-ref-tokens.js`,
`components/LinkifiedText.jsx`, `components/MentionTextarea.jsx`,
`app/api/entity-refs/resolve/route.js`, `app/api/entity-refs/search/route.js`.

**New (Round 2):** `components/EntityRefLink.jsx`, `components/RelatedItemsCard.jsx`,
`lib/use-entity-highlight.js`, `app/api/entity-refs/related/route.js`.

**Modified (original round):** `lib/db.js` (tasks.body column), `app/api/production/tasks/route.js`
(accept/insert body), `components/TicketsPanel.jsx` (send body, render `LinkifiedText`, mount
`MentionTextarea`), `components/WorkersPanel.jsx` (jc_no display fix), `components/ui/textarea.jsx`
(forwardRef), `components/CalcWorkspace.jsx` (drawing comments now tag).

**Modified (Round 2):** `lib/entity-refs.js` (`RELATIONS` registry, `getRelatedEntities`,
`resolveSalesInvoice`, `resolveVendorBill`, href corrections + `withHighlight()`, new
READ_GATE/SEARCH_GATE entries, `ENTITY_TYPES` now re-exported not redefined),
`lib/entity-ref-tokens.js` (`SI`/`VB` in `TOKEN_RE`, `ENTITY_TYPES` moved here),
`components/LinkifiedText.jsx` (imports `RefTooltip` from `EntityRefLink.jsx`),
`components/MentionTextarea.jsx` (imports the shared `ENTITY_TYPES`, no longer its own copy),
`components/NcrPanel.jsx`, `components/JobCardBoard.jsx`, `components/PackingDetail.jsx`,
`components/WorkOrdersPanel.jsx`, `components/BomTable.jsx`, `components/DesignPanel.jsx`,
`components/ProjectDepartmentTabs.jsx`, `components/StoresWorkspace.jsx`,
`components/ProcurementWorkspace.jsx`, `components/SalesWorkspace.jsx`,
`components/AccountsWorkspace.jsx`, `app/globals.css` (flash keyframe), `app/stores/page.js`,
`app/procurement/page.js`, `app/sales/page.js`, `app/accounts/page.js` (all four: `searchParams` →
`initialTab`).

**Deleted:** `components/EntityRefPicker.jsx` (superseded by `MentionTextarea.jsx`, original round).

**Untouched, despite being edited and reverted mid-session (original round):**
`components/PortalOrderProgress.jsx` — see "Drawing comments" section above for why.

**Unrelated, pre-existing, not touched by this work:** `components/QcDocumentEditor.jsx` shows
modified in `git status` from before the original round started — not part of this feature.
