// Load ITP templates from a JSON file through the real API (so every check in the template route runs).
//   BASE=http://localhost:3077 USER=qc_head PASS=... node scripts/seed-itp-templates.mjs scripts/demo/us-itp-templates.json [--apply]
// Without --apply it only validates the file (point numbers, earlier-only prerequisites) and prints the counts.
// An existing template with the same name is replaced (PUT), otherwise created.
import { readFileSync } from 'node:fs';
import { cleanItems } from '../lib/itp-template.mjs';

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file) { console.error('usage: node scripts/seed-itp-templates.mjs <file.json> [--apply]'); process.exit(1); }
const { templates } = JSON.parse(readFileSync(file, 'utf8'));
let bad = 0;
for (const t of templates) {
  const { items, errors } = cleanItems(t.items);
  console.log(`${t.name}: ${items.length} points, ${items.filter(i => i.point_type === 'H').length} hold, ${items.filter(i => i.point_type === 'W').length} witness${errors.length ? ` — ${errors.length} problems` : ''}`);
  for (const e of errors) console.log(`  ${e}`);
  bad += errors.length;
}
if (bad || !apply) process.exit(bad ? 1 : 0);

const BASE = process.env.BASE || 'http://localhost:3077';
const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.USER_NAME || process.env.USER || 'qc_head', password: process.env.PASS }) });
if (!login.ok) { console.error('login failed', login.status, await login.text()); process.exit(1); }
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error || ''}`);
  return j;
};
const existing = await call('GET', '/api/itp-templates');
for (const t of templates) {
  const e = existing.find(x => x.name === t.name);
  if (e) await call('PUT', `/api/itp-templates/${e.id}`, t); else await call('POST', '/api/itp-templates', t);
  console.log(`${e ? 'replaced' : 'created'}: ${t.name}`);
}
