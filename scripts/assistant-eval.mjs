// Checks the assistant's decisions against known questions, using dry runs (Jev only, no writing
// model): about 20 Jev calls, well under one cent in total.
//   node scripts/assistant-eval.mjs            (dev server on :3015, demo admin login)
//   BASE=http://localhost:3000 ADMIN_USER=admin ADMIN_PASS=... node scripts/assistant-eval.mjs
const BASE = process.env.BASE || 'http://localhost:3015';
// [question, screen, expected kind, words one of which must appear in the chosen section (howto only)]
const CASES = [
  ['How do I raise a purchase request?', '/pr', 'howto', ['purchase request']],
  ['How do I crop the company logo?', '/accounts', 'howto', ['logo']],
  ['Where do I close a gate inward receipt?', '/stores', 'howto', ['gate']],
  ['how to cut a plate and send the remnant back', '/production/workers', 'howto', ['remnant', 'cut']],
  ['How do I send a quotation to the customer by email?', '/sales', 'howto', ['quotation', 'email']],
  ['customer did not get the portal password, what do I do', '/sales', 'howto', ['portal']],
  ['How do I submit a packing list for approval before dispatch?', '/dispatch', 'howto', ['approval', 'packing']],
  ['where do I record a payment received against an invoice', '/accounts', 'howto', ['settlement', 'ledger', 'invoice', 'receipt', 'payment']],
  ['How much does HKM owe us right now?', '/sales', 'data', []],
  ['Which purchase orders are late this week?', '/procurement', 'data', []],
  ['thanks, that helped', '/', 'smalltalk', []],
  ['What is the capital of France?', '/', 'other', []],
];

const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'admin123' }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!login.ok || !cookie) { console.error('Login failed'); process.exit(1); }

let pass = 0;
for (const [q, path, kind, needles] of CASES) {
  const res = await fetch(`${BASE}/api/assistant/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ dry: true, path, messages: [{ role: 'user', content: q }] }) });
  const r = await res.json();
  if (!res.ok) { console.error(`STOP: ${r.error}`); process.exit(1); }
  const top = (r.sections[0] || '').toLowerCase();
  const ok = r.kind === kind && (!needles.length || needles.some(n => top.includes(n)));
  pass += ok;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${q}\n       ${r.trace.join(' · ')}`);
}
console.log(`\n${pass} of ${CASES.length} as expected`);
process.exit(pass === CASES.length ? 0 : 1);
