// Self-check for Ember's what-if pointer (market-intel plan D7): deterministic, no figures, points to the card, and the chat route
// answers it before any model call.
import { readFileSync } from 'node:fs';
import { whatIfPointer, linkify } from './assistant-help.mjs';

let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };
const hits = [
  'Should I buy the steel now or wait until fabrication starts?',
  'what if I buy plate now instead of next month',
  'What is the financing cost if I buy steel for SB-1109 early at 66000 per tonne?',
  'Steel prices are going up, is it better to purchase steel now or later?',
  'Do a what-if on steel purchase for this order',
  'buy now vs later for the plates',
  'What changes if we purchase steel now rather than later?',
  'How does an earlier steel purchase affect our financing cost?',
  'Can we compare different steel-price scenarios?',
  'What assumptions does the steel purchase estimate depend on?',
];
const misses = ['How do I raise a purchase request?', 'Where is the RFQ comparison?', 'How do I buy steel?', 'Which customers owe us money?',
  'Show stock of 12mm plate', 'How do I mark an order dispatched?', 'hello',
  'What is the rate of steel plate in stock?', 'Compare quotations from two suppliers', 'Which purchase orders are late?'];
for (const q of hits) {
  const p = whatIfPointer(q, { canSeeMoney: true });
  if (!p) { fail(`not recognised: ${q}`); continue; }
  if (/\d/.test(p.text)) fail(`the answer must carry no figure: ${p.text}`);
  if (!/don't calculate/.test(p.text) || !p.text.includes('Steel purchase timing (what-if)') || p.link !== '/projects') fail('the answer must point to the card');
  if (!linkify(p.text).some((x) => x.href === '/projects')) fail('the /projects path must render as a link');
  if (q.includes('66000') && p.text.includes('66000')) fail('the user\'s figure was echoed');
}
for (const q of misses) if (whatIfPointer(q, { canSeeMoney: true })) fail(`wrongly taken as a what-if question: ${q}`);
const other = whatIfPointer(hits[0], { canSeeMoney: false });
if (!other || other.text.includes('Steel purchase timing (what-if)": enter') || !/managers, Sales and Marketing/.test(other.text)) fail('people without money access must be told who can open it');

const route = readFileSync(new URL('../server/api/assistant/chat/route.js', import.meta.url), 'utf8');
const iPointer = route.indexOf('whatIfPointer(messages');
const iKey = route.indexOf('getAssistantKey()');
const iQuota = route.indexOf('useQuestion(user)');
const iFetch = route.indexOf('fetch(`${OPENROUTER}');
if (iPointer < 0 || !(iPointer < iKey && iPointer < iQuota && iPointer < iFetch)) fail('the pointer must be answered before the AI key, the quota and any model call');
console.log(failed ? `what-if pointer: ${failed} failure(s)` : 'what-if pointer: ok (deterministic, no figures, before any model call)');
process.exit(failed ? 1 : 0);
