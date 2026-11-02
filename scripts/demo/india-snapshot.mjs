// India snapshot check: the Indian demo must read exactly the same on this branch as on main.
// 1. Build main and this branch with MARKET unset, seed each with seed-acme.mjs on the same day, run each with DEMO_MODE=1.
// 2. Crawl each into a dump:  DUMP=/tmp/main.json QUIET=1 BASE=... ADMIN_PASSWORD=... DB_URL=... node scripts/demo/us-scan.mjs pages pdfs
// 3. node scripts/demo/india-snapshot.mjs /tmp/main.json /tmp/branch.json
// Prints every page/PDF whose text differs, with the lines only one side has, and exits 1 if any differ.
// Lines that differ only by a clock time (the two crawls run minutes apart) are ignored.
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const norm = t => String(t).split('\n').map(l => l.replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm|AM|PM)?\b/g, '<time>').replace(/\b\d+ (seconds?|minutes?|hours?) ago\b/g, '<ago>').trim()).filter(Boolean);
let diffs = 0;
for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
  if (!(key in a) || !(key in b)) { diffs++; console.log(`ONLY ON ${key in a ? 'main' : 'branch'}: ${key}`); continue; }
  const [la, lb] = [norm(a[key]), norm(b[key])];
  if (la.join('\n') === lb.join('\n')) continue;
  const count = l => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const [ca, cb] = [count(la), count(lb)];
  const onlyA = [...ca].filter(([x, n]) => (cb.get(x) || 0) < n).map(([x]) => x);
  const onlyB = [...cb].filter(([x, n]) => (ca.get(x) || 0) < n).map(([x]) => x);
  diffs++;
  console.log(`DIFF ${key}${!onlyA.length && !onlyB.length ? ' (same lines, different order)' : ''}`);
  onlyA.slice(0, 8).forEach(x => console.log(`  main:   ${x.slice(0, 200)}`));
  onlyB.slice(0, 8).forEach(x => console.log(`  branch: ${x.slice(0, 200)}`));
}
console.log(`${Object.keys(a).length} vs ${Object.keys(b).length} entries, ${diffs} differ`);
process.exit(diffs ? 1 : 0);
