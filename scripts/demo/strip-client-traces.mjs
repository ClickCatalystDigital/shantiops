// Public demo build only (npm run cf:build, after the OpenNext bundle): remove what would name the real client in
// the files the demo serves to browsers. The client's own Render build never runs this.
// - public/ fee pages (proposals to the client) would be served at boiler-erp.ahromlabs.com/fee.html etc.
// - Modules with a "run me as a script?" self-check (`import.meta.url === file://argv[1]`) get the absolute build
//   folder baked in (…/shanti-ops/lib/…, or …/shantiops/… in CI). The comparison is never true in a browser, so
//   the path is replaced with a neutral one.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = '.open-next/assets';
const FEE_PAGES = ['fee.html', 'fee2.html', 'final_fee.html'];
for (const f of FEE_PAGES) rmSync(join(ASSETS, f), { force: true });

const root = `file://${process.cwd()}/`;
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let n = 0;
for (const f of walk(ASSETS).filter(p => /\.(js|map|html|json|txt)$/.test(p))) {
  const s = readFileSync(f, 'utf8');
  if (s.includes(root)) { writeFileSync(f, s.split(root).join('file:///app/')); n++; }
}
console.log(`client traces: removed ${FEE_PAGES.length} fee pages, build path rewritten in ${n} file(s)`);
