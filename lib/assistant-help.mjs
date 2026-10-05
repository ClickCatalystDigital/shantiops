// Finds the help sections that answer a question, for the in-app assistant. No model and no vector
// store: the help guides are small, so plain word overlap is enough. Pure (the guides are passed in).
// ponytail: word overlap, no synonyms. If it misses too often, put a decision model (e.g. Jev) or
// embeddings in front of pickSections; nothing else needs to change.

const STOP = new Set('the a an and or of to in on for is are was be do does how what where when why which who can i we you my our it this that with from at by as not no yes if then into out up about get need want have has there their they them will would should could please'.split(' '));
export const words = s => String(s || '').toLowerCase().match(/[a-z0-9]{2,}/g)?.filter(w => !STOP.has(w)) || [];

// Every string inside a guide object, skipping icons and ids.
function collect(v, out) {
  if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); return; }
  if (Array.isArray(v)) { v.forEach(x => collect(x, out)); return; }
  if (!v || typeof v !== 'object' || v.$$typeof) return;
  for (const [k, x] of Object.entries(v)) if (k !== 'icon' && k !== 'key' && k !== 'children' && k !== 'features') collect(x, out);
}
const textOf = v => { const out = []; collect(v, out); return out.join('\n'); };

// guides = { [department]: guide } -> flat list of { dept, key, label, text }.
export function helpSections(guides) {
  const out = [];
  for (const [dept, guide] of Object.entries(guides)) {
    const { features = [], howTo, howToGroups, ...rest } = guide;
    out.push({ dept, key: 'intro', label: `${dept}: introduction`, text: textOf(rest) });
    const walk = f => {
      out.push({ dept, key: f.key, label: f.label, text: textOf(f) });
      (f.children || []).forEach(walk);
    };
    features.forEach(walk);
    const steps = textOf([howTo, howToGroups]);
    if (steps) out.push({ dept, key: 'how-to', label: `${dept}: how to`, text: steps });
  }
  return out;
}

// Edit distance, capped: returns true when a and b differ by at most `max` single-letter edits.
export function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}
// A mistyped word -> the guide word it most likely meant ("purchse" -> "purchase"). Words the guide
// already uses are kept. Only words of 5+ letters are corrected (1 edit; 2 edits from 8 letters).
let vocabOf = new WeakMap();
export function fixTypos(qWords, sections) {
  let v = vocabOf.get(sections);
  if (!v) { v = { all: new Set(), labels: new Set() }; for (const s of sections) { words(s.text).forEach(w => v.all.add(w)); words(s.label).forEach(w => v.labels.add(w)); } vocabOf.set(sections, v); }
  return qWords.map(w => {
    if (v.all.has(w) || w.length < 5) return w;
    const max = w.length >= 8 ? 2 : 1;
    for (const pool of [v.labels, v.all]) for (const c of pool) if (c[0] === w[0] && near(w, c, max)) return c;
    return w;
  });
}

// The few sections most likely to hold the answer. pageDept = department of the screen the user is on.
export function pickSections(sections, question, { pageDept = null, limit = 5, maxChars = 3500 } = {}) {
  const q = [...new Set(fixTypos(words(question), sections))];
  const scored = sections.map(s => {
    const label = new Set(words(s.label)), text = new Set(words(s.text));
    let score = 0;
    for (const w of q) score += (label.has(w) ? 4 : 0) + (text.has(w) ? 1 : 0);
    if (score && s.dept === pageDept) score += 2;
    return { s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  // Nothing matched: fall back to the introduction of the screen's department.
  const picked = scored.length ? scored.map(x => x.s) : sections.filter(s => s.dept === pageDept && s.key === 'intro');
  return picked.map(s => ({ ...s, text: s.text.slice(0, maxChars) }));
}

// First path segment -> department, for "which screen is the user on".
const PATH_DEPT = { sales: 'Sales', market: 'Marketing', pipeline: 'Marketing', procurement: 'Procurement', stores: 'Stores', pr: 'Stores', production: 'Production', planning: 'Production', qc: 'QC', dispatch: 'Dispatch', packing: 'Dispatch', installation: 'Installation', 'service-expenses': 'Installation', hr: 'HR', accounts: 'Accounts', engineering: 'Engineering', calc: 'Design', 'calc-drawings': 'Design' };
export const deptOfPath = path => PATH_DEPT[String(path || '').split('/')[1]] || null;

// ---- Decision step (Jev, a model that only picks from options you give it; lib/assistant.js calls it).
// Flow per question:
//   1. shortlist: the 24 guide sections sharing most words with the question (pickSections, no model)
//   2. one Jev call: what kind of question is it, and which shortlisted section answers it
//      (an earlier version asked Jev for the department first; "raise a purchase request" went to
//      Procurement, whose guide does not cover raising one, so the department step was dropped)
//   3. answer: canned reply (greeting / unrelated / live data), the guide text itself, or a writing model
export const KINDS = {
  howto: 'Asks how to do something in the app, where a screen or button is, or what a feature means',
  data: "Asks for the company's own live figures or records, e.g. an order's status, stock on hand, money owed, who did what",
  smalltalk: 'A greeting, thanks, or a remark with no question',
  other: 'Not about this app or this business at all (general knowledge, weather, jokes, coding, personal questions)',
  unclear: 'Gibberish, random letters, a single unclear word, or too vague or garbled to tell what is being asked',
};
export const CANNED = {
  data: "I can't see the company's data yet (orders, stock, payments). I can tell you which screen shows it: ask me where to find it.",
  smalltalk: 'Hello. Ask me how to do something in the app, for example "How do I raise a purchase request?"',
  other: 'I can only help with using this app. Ask me how to do something in it.',
  unclear: "I didn't understand that. Please ask again in a few more words, for example \"How do I raise a purchase request?\"",
};

export const kindQuestion = { kind: { type: 'choice', instructions: 'What kind of message is the latest question?', criteria: KINDS } };
// Asked in the same call: would the guide section do as written? Used by "show the guide" mode.
export const asIsQuestion = { as_is: { type: 'noul', instructions: 'Is the latest question a plain "how do I" or "where is" question about one feature, which a matching guide section would answer as written, with no follow-up, comparison or troubleshooting?' } };
// Which look-up answers a live-data question. tools = [{ key, about }].
export function toolQuestion(tools) {
  return { tool: { type: 'choice', instructions: "If the latest question asks for the company's live data, which look-up answers it?", criteria: { ...Object.fromEntries(tools.map(t => [t.key, t.about])), none: 'None of these look-ups can answer it, or it is not a question about live data' } } };
}

// Options are keyed s0, s1, ... so a label can hold any characters.
export function sectionQuestion(sections) {
  return {
    section: {
      type: 'choice', instructions: 'Which section of the guide answers the latest question?',
      // `none` lets Jev say the answer is not here (e.g. a question about another department's screens).
      criteria: { ...Object.fromEntries(sections.map((s, i) => [`s${i}`, `${s.label}: ${s.text.replace(/\s+/g, ' ').slice(0, 160)}`])), none: 'None of these sections is about what the latest question asks' },
    },
  };
}
// A choice answer -> its options, most likely first: [{ key, p }].
export function ranked(answer) {
  const probs = answer?.probabilities || (answer?.choice ? { [answer.choice]: 1 } : {});
  return Object.entries(probs).map(([key, p]) => ({ key, p: Number(p) || 0 })).sort((a, b) => b.p - a.p);
}
// The guide text as an answer, when no writing model is used.
export const guideAnswer = s => `${s.label}\n\n${s.text.slice(0, 1400)}${s.text.length > 1400 ? '…' : ''}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  const secs = helpSections({
    Stores: { title: 'Stores', intro: 'Receive and issue material.', features: [{ key: 'gir', label: 'Gate Inward', icon: () => null, body: ['Log the vehicle at the gate.'], children: [{ key: 'x', label: 'Close a GIR', body: ['Needs a GRN reference.'] }] }], howTo: [{ title: 'Reserve stock', text: 'Open Demand and click Reserve.' }] },
    Sales: { title: 'Sales', features: [{ key: 'q', label: 'Quotations', body: ['Create a commercial offer.'] }] },
  });
  eq(secs.map(s => `${s.dept}/${s.key}`), ['Stores/intro', 'Stores/gir', 'Stores/x', 'Stores/how-to', 'Sales/intro', 'Sales/q']);
  eq(secs[1].text.includes('Close a GIR'), false); // children are their own sections
  eq(pickSections(secs, 'how do I close a GIR?')[0].key, 'x');
  eq(pickSections(secs, 'quotation offer')[0].key, 'q');
  eq(pickSections(secs, 'zzz', { pageDept: 'Stores' }).map(s => s.key), ['intro']);
  eq(pickSections(secs, 'zzz'), []);
  eq(deptOfPath('/accounts/documents'), 'Accounts'); eq(deptOfPath('/'), null);
  eq(Object.keys(kindQuestion.kind.criteria), ['howto', 'data', 'smalltalk', 'other', 'unclear']);
  const sq = sectionQuestion(secs.filter(s => s.dept === 'Stores'));
  eq(Object.keys(sq.section.criteria), ['s0', 's1', 's2', 's3', 'none']);
  eq(ranked({ choice: 'a', probabilities: { a: 0.2, b: 0.7, c: 0.1 } }).map(r => r.key), ['b', 'a', 'c']);
  eq(ranked({ choice: 'a' }), [{ key: 'a', p: 1 }]); eq(ranked(null), []);
  eq(Object.keys(toolQuestion([{ key: 'a', about: 'x' }]).tool.criteria), ['a', 'none']);
  eq(near('purchse', 'purchase', 1), true); eq(near('angle', 'ankle', 1), true); eq(near('stores', 'sales', 1), false);
  eq(fixTypos(['quotaton', 'offer', 'gir', 'zzzzzz'], secs), ['quotations', 'offer', 'gir', 'zzzzzz']);
  eq(pickSections(secs, 'how to make a quotaton')[0].key, 'q');
  console.log('assistant-help ok');
}
