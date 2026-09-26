// Applies scripts/.tmp/links.json through the app's own review-queue route (history guard, unit fill, memory learning).
//   node scripts/apply-links-via-api.mjs [baseUrl]
import { readFileSync } from 'node:fs';
const base = process.argv[2] || 'http://localhost:3040';
const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'engg_head', password: 'engg_head123' }) });
const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
const links = JSON.parse(readFileSync('scripts/.tmp/links.json', 'utf8'));
const byProject = new Map();
for (const l of links) { if (!byProject.has(l.project_id)) byProject.set(l.project_id, []); byProject.get(l.project_id).push({ bom_item_id: l.bom_item_id, item_id: l.item_id }); }
let ok = 0, bad = 0;
for (const [pid, list] of byProject) for (let i = 0; i < list.length; i += 25) {
  const res = await fetch(`${base}/api/projects/${pid}/catalog-suggestions`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ links: list.slice(i, i + 25) }) });
  const j = await res.json().catch(() => ({}));
  if (res.ok) ok += list.slice(i, i + 25).length; else { bad += list.slice(i, i + 25).length; console.log(pid, res.status, JSON.stringify(j).slice(0, 200)); }
}
console.log({ ok, bad });
