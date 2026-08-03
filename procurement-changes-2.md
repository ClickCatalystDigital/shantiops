# Procurement Redesign — Changes Log (Round 2 / open items)

**Status:** Round 1 is shipped. The full spec, decisions, and as-built detail now live in
`SYSTEM.md` §5c (the as-built reference) and `PROCUREMENT-CHANGES.md` (kept in the repo as the
historical record of Round 1's investigation and build). **This file doesn't repeat anything
that's already in either of those** — it only tracks what's still open, or came up after Round 1
shipped.

---

## 1. Still open from Round 1

- **Overdue / blocked / due-soon pills on Operations** — kept for now; whether they're still wanted
  was never actually resolved, just deferred. Revisit when there's an opinion on it.

## 2. Future enhancements, not yet built

Both already flagged in `PROCUREMENT-CHANGES.md` §6 — listed here too since they're still pending:

- **Supplier contact intelligence** — auto-suggest who to reach out to per item, plus WhatsApp/email
  buttons on the Sourcing tab. Blocked on the client providing a real supplier list.
- **True multi-item "lot" requests** — a request is still one item today. Needs an Engineering/
  Design process conversation before it's worth building.

---

## 3. New: milestone auto-close (investigation only, nothing built)

The idea: once all of Procurement's work for a project is genuinely done, its milestone(s) close on
their own instead of relying on a head to notice — so Production's handoff notification fires
automatically. Nothing below has been built. This needs real decisions before it's buildable.

### 3a. The real milestone list (confirmed with the user)

Procurement owns **5** of the ~25 milestones in a project's chain, sitting back-to-back between
Design and Production:

1. Order BQ/Tubes
2. Procure Tubes
3. Order MS as per PR
4. Order all BOI Pump/Valves/SV/Motors
5. Order WLG/Casting/Panel

**Confirmed:** every project gets all 5, every time — no per-project skipping. This simplifies things:
no "does this project even need this milestone" branch to handle.

### 3b. What's actually blocking automation

- **No item currently knows which of the 5 it belongs to.** `bom_items` only carries `project_id` —
  nothing links an item to a specific milestone/category.
- **Checked directly against a real BOM file (`BOM.xlsx`, project SB-1103) — the gap is bigger than
  it first looked:**
  - The source spreadsheet Design actually fills in has no category column at all.
  - A project's BOM isn't one flat list — this file had it split across **5 separate equipment
    sheets** (Boiler, SDC, ID Fan, Chimney, Flue Gas Duct), each inconsistently structured (different
    column layouts sheet to sheet), and some sheets mix pure spec rows (e.g. a fan's RPM) in with
    real purchasable parts, with nothing structurally telling them apart.
  - The closest existing signal — informal section-header rows inside the flat list (e.g.
    "ELECTRICAL PANEL FOR BOILER") — roughly tracks the 5 milestones, but it's free text,
    inconsistent between sheets, and was never meant to be machine-readable.
  - **Practical conclusion:** the milestone-category tag needs to be assigned by a person — most
    naturally Design, at BOM/PR time, since they already own Part Description/Material Spec/Size —
    not inferred from existing free text after the fact.
- **Equipment sub-assemblies may need their own tag too**, separate from milestone category — in the
  sample file, the ID Fan's items were already mostly `RECEIVED` while the Boiler's were still ~90%
  `PENDING`, in the same project. Worth deciding if tracking equipment is in scope now or a separate
  later problem.
- **Even with tagging in place, still open before any auto-close logic gets written:**
  - Does a `CANCELLED` item count as "done," or does the milestone wait for a replacement request?
  - Does a milestone reopen if a new request lands after it's already auto-closed?
  - Who/what picks a delay-category reason on a late auto-close, given every other late close in the
    app prompts a human for one?
  - Silent auto-close, or an auto-suggested "ready to close" a head still confirms — closer to how
    every other close in the app already works?
- **Minor note for whenever real BOM data actually gets imported** (not this round — Round 1
  deliberately reseeded a small demo dataset instead, per `PROCUREMENT-CHANGES.md` §7): the real
  file's status column uses `CANCELED` (one L), not the app's `CANCELLED` — needs normalizing on
  import or rows will silently fail to match.

### 3c. Milestone board as a Kanban — approved as a task to build and verify

Reskin the existing departmental milestone board (kept in Round 1, `SYSTEM.md` §5c) as a Kanban —
**Open → Current → Closed** — where dragging a card fires the **same** Start/Close action the
milestone drawer already uses. This is the one concrete, buildable task in this round: confirm it
calls the existing action rather than a new parallel status field, so the built-in delay-reason
prompt and the real handoff notification keep working rather than getting a second, disconnected
source of truth for "is this milestone done."

---

## 4. Not decided yet

- Whether/how equipment (Boiler vs. ID Fan vs. Chimney, etc.) becomes its own tracked attribute.
- The four auto-close-readiness questions in §3b.
- Kanban implementation details beyond "it must call the same Start/Close action."

Once these get resolved and built, fold the result into `SYSTEM.md` the same way Round 1 did, and
trim this file back down again.
