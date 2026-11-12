// Cue Cards beyond today's prompts (lib/cue-cards.js): the steel purchase what-if, and what is planned. Pure, so its self-check
// runs without a database. The same status meanings are published on ahromlabs.com (src/lib/ai-assistant.ts in the website repo);
// that repo's scripts/ai-assistant.check.ts reads this file and fails if the two disagree.
//
// Status inside the app needs no "not deployed" word: a card is in the code only where the feature is, so on any deployment
// running this file the what-if cards are live. The website, which describes deployments, carries "built, not yet live" itself.
export const CARD_STATUS = {
  live: 'Live',
  off: 'Built, switched off here',
  planned: 'Planned, not available yet',
};

// Each prompt must get Ember's fixed pointer to the what-if card (whatIfPointer in lib/assistant-help.mjs), never a calculation.
export const WHATIF_CARDS = [
  'What changes if we purchase steel now rather than later?',
  'How does an earlier steel purchase affect our financing cost?',
  'Can we compare different steel-price scenarios?',
  'What assumptions does the steel purchase estimate depend on?',
];

// Planned and not available. Shown without an Ask button. Wording says what it would use, never a result.
export const PLANNED_GROUPS = [
  { key: 'operational', label: 'Next: operational intelligence from your own records',
    blurb: 'From this system’s own BOM, stock, purchase orders, milestones and payments, with the records and assumptions behind every answer. A first version is built and tested by Ahrom Labs on sample boiler orders; it is not in this system yet. Calculations stay fixed arithmetic; your data stays in your system.' },
  { key: 'industry', label: 'Later: industry intelligence',
    blurb: 'Combines checked industry knowledge, steel and policy changes and approved calculations, and says what changed, why it matters to you and how sure it is.' },
];
export const PLANNED = [
  { group: 'operational', q: 'Which plates, pipes and fittings still to buy are exposed if prices rise?', uses: 'the BOM, reserved stock, fixed-price purchase orders, quoted rates and an approved price index' },
  { group: 'operational', q: 'What will the cash gap on this order cost us?', uses: 'the order’s own payment terms, milestones and payments' },
  { group: 'operational', q: 'Which delayed milestones will hold up dispatch?', uses: 'milestone dates and what depends on them' },
  { group: 'operational', q: 'Which unpaid balances put a project at risk?', uses: 'invoices, payments and project stages' },
  { group: 'operational', q: 'Which three issues should I review today, and what should I check next?', uses: 'the issues above, ranked by measured amount and urgency; “nothing today” is a valid answer' },
  { group: 'industry', q: 'What changed in steel prices or rules this month that matters to us?', uses: 'checked public sources, compared with your open orders' },
  { group: 'industry', q: 'Which of our decisions does that change, and how sure is it?', uses: 'approved calculations, with their freshness and confidence' },
];
