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

// The few sections most likely to hold the answer. pageDept = department of the screen the user is on.
export function pickSections(sections, question, { pageDept = null, limit = 5, maxChars = 3500 } = {}) {
  const q = [...new Set(words(question))];
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
  console.log('assistant-help ok');
}
