# Calc Sheets from chat (Ember AI and MCP): plan

Status: planned, not built. Start after the Design department demo video is recorded.

## Goal

A Design or Engineering user does everyday calculation work by typing in Ember AI (the help assistant) or from
Claude / ChatGPT through MCP, without opening the worksheet. For example:

- "Make a calc sheet for SO-6."
- "What fails on AB-1003 if design pressure is 12.5?"
- "Set tube plate thickness to 16 on SO-6 and save it."
- "Send me the calculation PDF for AB-1001."

Every change follows the same rules as the screen. Nothing new is decided in chat: the formulas, checks and permissions
stay where they are today.

## How it fits what exists

- **Actions** go into `lib/assistant-actions.js`, one entry per task, each describing an existing API route. The route's
  own checks decide (`requireCalcAccess`: Design or Engineering; formula changes stay Design Head only).
  - In chat, a card with Save; in Auto mode, actions with a clean undo save at once.
  - In MCP, `propose_action` then `confirm_action`.
- **Questions** (read-only) go into `lib/assistant-data.js` look-ups. They run the real calc engine
  (`computeAll`, `runValidations` in `lib/calc-engine.js`) on the sheet's stored values, so an answer always matches
  the worksheet.
- **What-if questions** run the engine with the changed values in memory and save nothing. Saving needs a separate,
  confirmed action.
- A sheet is named by its project number, customer, sheet name or CS number (record matching as for other kinds:
  add a `calc_sheet` kind to `KINDS` with its project and customer text).

## Tasks

### Read-only (answers, no card)

| Ask | Answer from |
|---|---|
| Which sheets does SO-6 have? | `getAllCalcSheets()` filtered by project |
| Does AB-1003 pass? Which checks fail? | engine on the sheet's values; list failing checks with their message |
| What is the shell thickness / required plate on AB-1003? | engine result + unit + IBR clause of the formula |
| What if design pressure is 12.5 (or capacity 2500)? | engine with the override, no save; say what changes from pass to fail |
| What is the smallest plate thickness that passes at 12.5? | existing `goalSeek` in `lib/calc-engine.js` |
| When was AB-1001 last saved, and by whom? | latest `calc_snapshots` row |

### Changes (card in chat, propose/confirm in MCP)

| Action key | Route it calls | Undo |
|---|---|---|
| `create_calc_sheet` (project, name) | `POST /api/calc-sheets` (starts from the project's size) | delete the sheet |
| `set_calc_input` (sheet, input, value) | `PATCH /api/calc-variables/[id]` | restore old value |
| `apply_calc_template` (sheet, template) | the template apply route (`server/api/calc-templates/[id]`) | restore old values (needs a multi-value restore) |
| `save_calc_snapshot` (sheet, note) | `POST /api/calc-snapshots`; reply with the PDF link `/api/calc-snapshots/[id]/pdf` | none (snapshots are the record) |
| `link_calc_to_drawing` (sheet, drawing) | `server/api/calc-drawings/[id]/calc-sheets` | unlink |
| `delete_calc_sheet` (sheet) | `DELETE /api/calc-sheets/[id]` | none; always the card, never Auto |

Not in chat: editing or approving formulas, checks and tables. Those stay on the Formulas screen with Design Head
approval.

## Details to settle when building

- **Input names.** People say "tube plate thickness", the system says `EndPlateThk`. Match against the labels in
  `calc_input_defs` (label, group, unit). Ask back when two inputs match equally.
- **Units.** A value given in other units (bar, psi, inches) is converted with mathjs units, the same as the engine, and
  the card shows both ("12.5 bar = 12.75 kgf/cm2").
- **One change, one card.** "Make it 12.5 and 16 mm" becomes two inputs on one card. Check whether the action format
  allows a list, or use two cards.
- **Answer format.** Lead with pass/fail ("All 22 checks pass" or "1 check fails: Tube plates…"), then the numbers. Never
  dump all 67 results.
- **Cue Cards.** Add L2/L5 prompts for Design, filled from real sheets, e.g. "Which checks fail on {sheet}?" and
  "Save a snapshot of {sheet}".
- **Eval.** Add the sentences above to `scripts/assistant-eval.mjs`, and the actions to `scripts/check-actions.mjs`
  (scratch database only).
- **Demo.** Writes on the public demo follow the existing demo rules. Check that the chat can't create sheets on
  another visitor's data in a way the screen doesn't allow.

## Done when

- Every task above works from Ember AI and from MCP.
- The role check passes: Design / Engineering get the actions, other departments don't.
- The eval and action checks pass.
- The answers match the worksheet and the PDF for the same sheet.
