// Fails (exit 1) if the demo mentions the real customer anywhere a visitor could see it. Run before publishing a golden DB.
//   DB_URL=... DB_TOKEN=... node scripts/demo/scrub-check.mjs
// Checks, in order:
//   1. every text column of the demo database;
//   2. the browser bundle the demo serves (.open-next/assets after `npm run cf:build`, else .next/static; skipped if neither);
//   3. the source of the PDF templates and the OPS AI prompts (comments ignored); pages and components are listed as
//      warnings only (they are the client's live app code);
//   4. with BASE + ADMIN_PASSWORD (a running app on this database): every kind of PDF the demo produces is downloaded and
//      its text must name the demo company and nothing from the deny list.
import { createClient } from '@libsql/client';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Short or common tokens are matched as whole words so minified code doesn't trip them.
import { DENY, DENY_WORDS } from './deny-list.mjs';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const denyRe = new RegExp([...DENY.map(esc), ...DENY_WORDS.map(w => `\\b${esc(w)}\\b`)].join('|'), 'i');

let hits = 0, uiWarnings = 0;
const hit = (where, text) => { hits++; console.log(`${where}: ${text.slice(0, 160)}`); };

// --- 1. database --------------------------------------------------------------------------------
const db = createClient({ url: process.env.DB_URL, authToken: process.env.DB_TOKEN, intMode: 'number' });
const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(r => r.name);
const words = [...DENY, ...DENY_WORDS];
for (const t of tables) {
  const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.filter(c => /TEXT|CHAR|DATE|^$/i.test(c.type)).map(c => c.name);
  for (const c of cols) {
    // One query per column, a count per deny word (LIKE is case-insensitive for ASCII).
    const r = await db.execute({ sql: `SELECT ${words.map(() => `SUM("${c}" LIKE ?)`).join(', ')} FROM "${t}"`, args: words.map(w => `%${w}%`) });
    Object.values(r.rows[0]).forEach((n, i) => { if (n) hit(`${t}.${c} ~ "${words[i]}"`, `${n} row(s)`); });
  }
}
console.log(`db: ${tables.length} tables scanned`);

// --- 2. browser bundle --------------------------------------------------------------------------
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const bundle = ['.open-next/assets', '.next/static'].find(existsSync);
if (bundle) {
  const files = walk(bundle).filter(f => /\.(js|html|json|css|txt)$/.test(f));
  for (const f of files) { const m = readFileSync(f, 'utf8').match(denyRe); if (m) hit(f, `"${m[0]}"`); }
  console.log(`bundle: ${files.length} files in ${bundle}`);
} else console.log('bundle: no build output, skipped (run npm run cf:build first to include it)');

// --- 3. PDF templates and assistant prompts (source) -----------------------------------------------
const sources = [...readdirSync('lib').filter(f => /pdf\.js$|^packing-forms\.mjs$|^installation-report-template\.mjs$|^assistant/.test(f)).map(f => `lib/${f}`),
  ...walk('server/api/assistant').filter(f => f.endsWith('.js')),
  // Pages and components: what the browser bundle is built from (stands in for step 2 without a build).
  ...['app', 'components'].flatMap(d => walk(d)).filter(f => /\.(js|jsx)$/.test(f) && !f.startsWith('app/api/'))];
for (const f of sources) {
  // Blank out /* */ comments (keeping line numbers), then skip // lines.
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n').forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    const m = line.replace(/\s\/\/.*$/, '').match(denyRe);
    if (!m) return;
    // Pages/components are the client's live app too: a hit there needs Pujan's OK to change, so it is
    // reported, not failed on (templates and AI prompts still fail).
    if (/^(app|components)\//.test(f)) { uiWarnings++; console.log(`UI code (not failed, needs an app change): ${f}:${i + 1}: ${line.trim().slice(0, 140)}`); }
    else hit(`${f}:${i + 1}`, line.trim());
  });
}
console.log(`source: ${sources.length} template/prompt/page files${uiWarnings ? `, ${uiWarnings} UI code warning(s)` : ''}`);

// --- 4. rendered PDFs -------------------------------------------------------------------------------
const { BASE, ADMIN_PASSWORD } = process.env;
if (BASE && ADMIN_PASSWORD) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  // [label, table, path]: the first row of each table is printed.
  const PDFS = [['quotation', 'quotations', 'quotations/:id/pdf'], ['sale order', 'sale_orders', 'sale-orders/:id/order-pdf'],
    ['purchase order', 'purchase_orders', 'purchase-orders/:id/pdf'], ['sales invoice', 'sales_invoices', 'sales-invoices/:id/pdf'],
    // Test certificates print inside the QC folder (their own /pdf route is the supplier's uploaded scan).
    ['QC folder (Form IV)', 'qc_documents', 'qc-documents/:id/pdf'],
    ['packing list', 'packing_lists', 'packing/:id/pdf'], ['shipment', 'shipments', 'shipments/:id/pdf'],
    ['installation report', 'installation_reports', 'installation-reports/:id/pdf'], ['material indent', 'material_indents', 'material-indents/:id/pdf']];
  for (const [label, table, path] of PDFS) {
    const id = (await db.execute(`SELECT id FROM ${table} ORDER BY id LIMIT 1`)).rows[0]?.id;
    if (!id) { hit(`pdf ${label}`, `no ${table} row to print`); continue; }
    const res = await fetch(`${BASE}/api/${path.replace(':id', id)}`, { headers: { cookie } });
    if (!res.ok || !/pdf/.test(res.headers.get('content-type') || '')) { hit(`pdf ${label}`, `HTTP ${res.status} ${res.headers.get('content-type')}`); continue; }
    const pdf = await getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) text += (await (await pdf.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
    const m = text.match(denyRe);
    if (m) hit(`pdf ${label}`, `"${m[0]}"`);
    else if (!/acme/i.test(text)) hit(`pdf ${label}`, 'no "Acme" on it (letterhead missing?)');
    else console.log(`pdf ${label}: ok, ${pdf.numPages} page(s)`);
  }
} else console.log('pdf: BASE/ADMIN_PASSWORD not set, skipped');

console.log(`${hits} hit(s)`);
process.exit(hits ? 1 : 0);
