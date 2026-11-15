// Self-check for the what-if and planned Cue Cards (lib/cue-cards-intel.mjs): every what-if card gets the fixed pointer, nothing
// planned is offered as askable, and the page wiring keeps planned items without an Ask button.
import { readFileSync } from 'node:fs';
import { WHATIF_CARDS, PLANNED, PLANNED_GROUPS, CARD_STATUS } from './cue-cards-intel.mjs';
import { whatIfPointer } from './assistant-help.mjs';

let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };
for (const q of WHATIF_CARDS) {
  const p = whatIfPointer(q, { canSeeMoney: true });
  if (!p || p.link !== '/projects') fail(`what-if card does not get the pointer: ${q}`);
  if (p && /\d/.test(p.text)) fail('pointer text must carry no figures');
}
if (WHATIF_CARDS.length < 4) fail('the four buyer questions must all be cards');
const groups = new Set(PLANNED_GROUPS.map((g) => g.key));
for (const p of PLANNED) {
  if (!groups.has(p.group)) fail(`planned item in unknown group: ${p.q}`);
  if (!p.uses) fail(`planned item must say what it would use: ${p.q}`);
}
if (JSON.stringify(Object.keys(CARD_STATUS)) !== JSON.stringify(['live', 'off', 'planned'])) fail('status keys changed: update the website check too');
const cards = readFileSync(new URL('./cue-cards.js', import.meta.url), 'utf8');
for (const must of ['WHATIF_CARDS', "type: 'pointer'", 'off: true', 'PLANNED']) if (!cards.includes(must)) fail(`lib/cue-cards.js lacks ${must}`);
const ui = readFileSync(new URL('../components/CueCards.jsx', import.meta.url), 'utf8');
for (const must of ['planned', 'CARD_STATUS', 'disabled={c.off}']) if (!ui.includes(must)) fail(`components/CueCards.jsx lacks ${must}`);
console.log(failed ? `cue cards (what-if, planned): ${failed} failure(s)` : `cue cards (what-if, planned): ok (${WHATIF_CARDS.length} what-if cards get the pointer; ${PLANNED.length} planned, not askable)`);
process.exit(failed ? 1 : 0);
