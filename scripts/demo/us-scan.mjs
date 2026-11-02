// US demo scan (boiler-erp-us): fails (exit 1) if anything Indian shows in the US demo. Extends scrub-check.mjs (which
// guards the client's names) with the US deny list from the North America plan. Run against a local US build:
//   DB_URL=file:/tmp/us.db BASE=http://localhost:3077 ADMIN_PASSWORD=... node scripts/demo/us-scan.mjs [db] [bundle] [pages] [pdfs] [ai]
// (no section names = all). The app must run with MARKET=NA, NEXT_PUBLIC_MARKET=NA and DEMO_MODE=1.
// Sections:
//   db      every text value in every table
//   bundle  the browser bundle (.open-next/assets, else .next*/static): reported, not failed (code for hidden India-only
//           screens is still shipped; what a visitor can see is checked by pages/pdfs)
//   pages   headless Chrome (DevTools protocol, no extra dependency) signs in as every /demo role, follows every link and
//           clicks every tab, and checks the rendered text and page title
//   pdfs    every PDF the demo prints (a fixed list plus every PDF link the crawl found): text and Letter page size
//   ai      Ember AI's system prompt and starter answers (needs an AI key on the server; prompt text is checked without)
import { createClient } from '@libsql/client';
import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { DENY, DENY_WORDS } from './deny-list.mjs';
import { DEMO_ROLES } from '../../lib/demo-roles.js';

// --- the US deny list -------------------------------------------------------------------------------------------
// Phrases: case-insensitive substrings. Words: case-insensitive whole words. Acronyms: case-sensitive whole words.
export const US_PHRASES = ['₹', 'lakh', 'crore', 'GSTIN', 'GSTR', 'CGST', 'SGST', 'IGST', 'e-way', 'eway', 'Tally', 'IFSC', 'NEFT',
  'RTGS', '+91', 'Kolkata', 'Pvt Ltd', 'Pvt. Ltd', 'Private Limited', 'Aadhaar', 'Aadhar', 'kharchi', 'kg/cm', 'kgf/cm', 'IndiaMART', 'TradeIndia',
  'JustDial', 'Ahmedabad', 'Mumbai', 'Delhi', 'Pune', 'Hyderabad', 'Chennai', 'Bengaluru', 'Bangalore', 'Vadodara', 'Nashik', 'Gujarat',
  'Maharashtra', 'Telangana', 'Karnataka', 'Tamil Nadu', 'Kerala', 'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh', 'Kolhapur', 'Mysuru',
  'Indore', 'Raipur', 'MIDC', 'Diwali', 'Deepavali', 'Navratri', 'Dussehra', 'Janmashtami', 'Raksha Bandhan', 'Pongal', 'Ganesh Chaturthi',
  'Republic Day', 'Gandhi Jayanti', 'Boilers Act', 'Director of Boilers', 'Directorate', 'Udyam', 'Provident Fund', 'Professional Tax',
  'Form 16', 'Section 393', 'Section 194', 'Income Tax Act', 'quotation', 'enquir'];
export const US_WORDS = ['India', 'Indian', 'Rupee', 'Rupees', 'paise', 'Surat', 'Holi', 'Shri', 'Smt', 'ji', 'bhai', 'kya', 'nahi', 'haan',
  'acha', 'accha', 'theek', 'karo', 'kripya', 'dhanyavad', 'namaste', 'A4'];
export const US_ACRONYMS = ['INR', 'GST', 'HSN', 'SAC', 'PAN', 'TDS', 'TCS', 'IRN', 'UPI', 'IST', 'IBR', 'PF', 'EPF', 'ESI', 'ESIC', 'UAN', 'CIN',
  'MSME', 'BIS', 'ISI', 'NB', 'GeM', 'Rs', 'Nos', 'Mtr', 'Mtrs', 'Kgs'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ciRe = new RegExp([...US_PHRASES.map(esc), ...DENY.map(esc), ...[...US_WORDS, ...DENY_WORDS].map(w => `(?<![\\w-])${esc(w)}(?![\\w-])`)].join('|'), 'gi');
const csRe = new RegExp(US_ACRONYMS.map(w => `(?<![\\w-])${w}(?![\\w-])`).join('|'), 'g');
// An Indian financial year, e.g. 2026-27 (a month like 2026-11 is not one).
const fyRe = /\b20(\d\d)-(\d\d)\b/g;
// Allowed on purpose: "NB" as in National Board (stamped "NB" numbers), "FY" never used by the US screens but kept
// flagged; US state "IN" (Indiana) is not on the list.
const ALLOW = [/\bNB[ -]\d/, /National Board/, /\{\{\w+\}\}/, /^TDS\b.{0,20}(blow|ppm|\))/i, /per TDS/, /dissolved/];

export function findIndian(text) {
  if (!text) return [];
  const t = String(text);
  const out = [];
  for (const re of [ciRe, csRe]) for (const m of t.matchAll(re)) out.push({ term: m[0], at: m.index });
  for (const m of t.matchAll(fyRe)) if (Number(m[2]) === (Number(m[1]) + 1) % 100) out.push({ term: m[0], at: m.index });
  // A URL path segment (/sales/quotations) is an address, not wording: the app links it under the tab's US name.
  return out.filter(h => t[h.at - 1] !== '/').filter(h => !ALLOW.some(a => a.test(t.slice(Math.max(0, h.at - 24), h.at + 24)) || a.test(t.slice(h.at, h.at + 24))))
    .map(h => ({ ...h, context: t.slice(Math.max(0, h.at - 50), h.at + 50).replace(/\s+/g, ' ') }));
}

// --- run --------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const want = s => !args.length || args.includes(s);
const { DB_URL, DB_TOKEN, BASE = 'http://localhost:3077', ADMIN_PASSWORD, CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } = process.env;
const MAX_PAGES = Number(process.env.MAX_PAGES || 60);
let hits = 0;
const seen = new Set();
// DUMP=<file>: also write every page's and PDF's text to a JSON file (the India snapshot check diffs two of these:
// scripts/demo/india-snapshot.mjs). QUIET=1: don't print hits (an Indian build is full of them by design).
const DUMP = process.env.DUMP, QUIET = !!process.env.QUIET;
const dump = {};
function report(where, text) {
  if (DUMP) dump[where] = (dump[where] ? dump[where] + '\n' : '') + text;
  if (QUIET) return;
  for (const h of findIndian(text)) {
    const key = `${where}|${h.term.toLowerCase()}|${h.context}`;
    if (seen.has(key)) continue;
    seen.add(key); hits++;
    console.log(`HIT ${where}: "${h.term}"  …${h.context}…`);
  }
}

async function scanDb() {
  const db = createClient({ url: DB_URL, authToken: DB_TOKEN, intMode: 'number' });
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(r => r.name);
  let values = 0;
  for (const t of tables) {
    // Internal identifiers (keys, links, counters, audit action codes) never reach a screen as text.
    if (INTERNAL_TABLES.has(t)) continue;
    const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.filter(c => /TEXT|CHAR|DATE|^$/i.test(c.type))
      .map(c => c.name).filter(c => !/_key$|^link$/.test(c));
    if (!cols.length) continue;
    const rows = (await db.execute(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${t}"`)).rows;
    for (const r of rows) for (const c of cols) if (typeof r[c] === 'string') { values++; report(`db ${t}.${c}`, r[c]); }
  }
  console.log(`db: ${tables.length} tables, ${values} text values`);
}

function scanBundle() {
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const dir = ['.open-next/assets', '.next/static', '.next-3077/static'].find(existsSync);
  if (!dir) return console.log('bundle: no build output, skipped');
  const counts = {};
  for (const f of walk(dir).filter(f => /\.(js|html|json|css|txt)$/.test(f))) {
    for (const h of findIndian(readFileSync(f, 'utf8'))) counts[h.term] = (counts[h.term] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`bundle (${dir}, reported only): ${top || 'clean'}`);
}

// Minimal DevTools-protocol client over Node's built-in WebSocket.
async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), 'us-scan-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 50 && !list; i++) { await sleep(200); list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null); }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const waiters = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) for (const w of waiters.splice(0)) w(m);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  await send('Page.enable');
  return { send, close };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function signIn(username) {
  const res = await fetch(`${BASE}/api/demo/enter`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'demo_lead=us-scan' }, body: JSON.stringify({ username }) });
  if (!res.ok) throw new Error(`demo sign-in ${username}: ${res.status} ${await res.text()}`);
  return { token: res.headers.getSetCookie().find(c => c.startsWith('token=')).split(';')[0].slice(6), home: (await res.json()).home || '/' };
}

// Rendered text of the page plus each tab's panel (tabs clicked in turn), its links and PDF links.
const READ = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const texts = [document.title, document.body.innerText];
  // Every workspace sidebar item, and within each the inner tabs (capped so one page can't run away).
  const side = [...document.querySelectorAll('[data-sidebar=menu-button],[data-sidebar=menu-sub-button],aside nav button')].slice(0, 40);
  const clickTabs = async () => { for (const t of [...document.querySelectorAll('[role=tab]')].slice(0, 12)) { t.click(); await wait(600); texts.push(document.body.innerText); } };
  await clickTabs();
  for (const b of side) { b.click(); await wait(900); texts.push(document.body.innerText); await clickTabs(); }
  const links = [...document.querySelectorAll('a[href]')].map(a => a.href);
  return JSON.stringify({ text: texts.join('\\n'), links });
})()`;

async function scanPages(pdfLinks) {
  const c = await chrome();
  const origin = new URL(BASE).origin;
  const visit = async url => {
    await c.send('Page.navigate', { url });
    await sleep(Number(process.env.WAIT_MS || 2500)); // a deployed site needs longer (WAIT_MS=6000)
    const r = await c.send('Runtime.evaluate', { expression: READ, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value;
    if (typeof v !== 'string') { hits++; console.log(`HIT page ${url}: could not read the page (${r.result?.exceptionDetails?.text || 'not loaded'})`); return { text: '', links: [] }; }
    return JSON.parse(v);
  };
  // The public entry page, before signing in.
  report('page /demo (visitor)', (await visit(`${BASE}/demo`)).text);
  let pages = 1;
  // ROLES=a,b: only those demo logins (a quick re-check); default every role.
  for (const role of DEMO_ROLES.filter(r => !process.env.ROLES || process.env.ROLES.split(',').includes(r.username))) {
    let token, home;
    try { ({ token, home } = await signIn(role.username)); } catch (e) { hits++; console.log(`HIT sign-in ${role.username}: ${e.message}`); continue; }
    await c.send('Network.setCookie', { name: 'token', value: token, url: origin });
    await c.send('Network.setCookie', { name: 'demo_lead', value: 'us-scan', url: origin });
    // The manager (every department) also starts from every page in app/ that has no [param] in its path.
    const routes = role.username === 'manager' ? staticRoutes().map(r => new URL(r, BASE).href) : [];
    const queue = [new URL(home, BASE).href, ...routes], done = new Set();
    const cap = role.username === 'manager' ? MAX_PAGES * 3 : MAX_PAGES;
    while (queue.length && done.size < cap) {
      const url = queue.shift();
      const key = url.replace(/#.*$/, '');
      if (done.has(key)) continue;
      done.add(key); pages++;
      const { text, links } = await visit(url);
      report(`page ${new URL(url).pathname}${new URL(url).search} (${role.username})`, text);
      for (const l of links) {
        if (!l.startsWith(origin) || /logout|\/api\/auth|mailto:|tel:/.test(l)) continue;
        if (/\/pdf(\?|$)|\.pdf(\?|$)/.test(l)) { pdfLinks.add(l.replace(origin, '')); continue; }
        if (!done.has(l.replace(/#.*$/, ''))) queue.push(l);
      }
    }
    console.log(`pages: ${role.username} ${done.size} page(s)`);
  }
  c.close();
  console.log(`pages: ${pages} in all, ${pdfLinks.size} PDF link(s) found`);
}

function staticRoutes() {
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  return walk('app').filter(f => f.endsWith('/page.js') && !f.includes('['))
    .map(f => f.slice(3, -8) || '/').filter(r => !/^\/(login|d-login|set-password|change-password|demo)$/.test(r));
}

async function scanPdfs(pdfLinks) {
  if (!ADMIN_PASSWORD || !DB_URL) return console.log('pdfs: ADMIN_PASSWORD / DB_URL not set, skipped');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const db = createClient({ url: DB_URL, authToken: DB_TOKEN, intMode: 'number' });
  const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }) });
  // DEMO_MODE refuses /api/login only through /login; the API itself answers. Fall back to the manager role if not.
  const cookie = login.ok ? login.headers.getSetCookie().find(c => c.startsWith('token=')).split(';')[0] : `token=${(await signIn('manager')).token}`;
  // [label, table, path, where]: the rows of each table are printed (first few).
  const PDFS = [['estimate', 'quotations', 'quotations/:id/pdf'], ['sale order', 'sale_orders', 'sale-orders/:id/order-pdf'],
    ['purchase order', 'purchase_orders', 'purchase-orders/:id/pdf'], ['sales invoice', 'sales_invoices', 'sales-invoices/:id/pdf'],
    ['QC folder (ASME record package)', 'qc_documents', 'qc-documents/:id/pdf'], ['packing list', 'packing_lists', 'packing/:id/pdf'],
    ['shipment', 'shipments', 'shipments/:id/pdf'], ['installation report', 'installation_reports', 'installation-reports/:id/pdf'],
    ['material indent', 'material_indents', 'material-indents/:id/pdf'], ['salary slip', 'salary_slips', 'salary-slips/:id/pdf'],
    ['gate pass', 'gate_passes', 'gate-passes/:id/pdf'], ['job card', 'job_sheets', 'job-sheets/:id/pdf']];
  const paths = new Set(pdfLinks);
  for (const [, table, path] of PDFS) {
    const exists = (await db.execute(`SELECT name FROM sqlite_master WHERE name = ?`, [table])).rows.length;
    if (!exists) continue;
    for (const { id } of (await db.execute(`SELECT id FROM ${table} ORDER BY id LIMIT 3`)).rows) paths.add(`/api/${path.replace(':id', id)}`);
  }
  let n = 0;
  for (const p of paths) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/pdf/.test(type)) { if (res.status !== 404) console.log(`pdf ${p}: HTTP ${res.status} ${type} (not checked)`); continue; }
    const pdf = await getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const [, , w, h] = page.view;
      const size = [Math.round(Math.min(w, h)), Math.round(Math.max(w, h))].join('x');
      if (size !== '612x792' && !/label|sticker|nameplate/i.test(p)) { hits++; console.log(`HIT pdf ${p}: page ${i} is ${size} pt, not Letter (612x792)`); break; }
      text += (await page.getTextContent()).items.map(t => t.str).join(' ') + '\n';
    }
    report(`pdf ${p}`, text);
    n++;
  }
  console.log(`pdfs: ${n} checked`);
}

async function scanAi() {
  // What Ember receives in this build (run with MARKET=NA): the two system prompts, evaluated; the general help and
  // the screen/tab list after the US filter. The department guide is the /help page, which the page crawl reads.
  const { usDeep, IS_US } = await import('../../lib/market.js');
  const route = readFileSync('server/api/assistant/chat/route.js', 'utf8');
  for (const name of ['SYSTEM', 'DATA_SYSTEM']) {
    const tpl = route.match(new RegExp(`const ${name} = (\`[\\s\\S]*?\`);`))?.[1];
    if (tpl) report(`ai prompt ${name}`, new Function('IS_US', `return ${tpl}`)(IS_US));
  }
  const lib = readFileSync('lib/assistant.js', 'utf8');
  const general = lib.match(/const GENERAL = usDeep\((\{[\s\S]*?\n\})\);/)?.[1];
  if (general) report('ai prompt general help', JSON.stringify(new Function('usDeep', `return usDeep(${general})`)(usDeep)));
  const help = await import('../../lib/assistant-help.mjs');
  report('ai prompt screens and tabs', help.screenList(['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation', 'Sales', 'Marketing', 'HR', 'Accounts'], null) + JSON.stringify(help.CANNED));
  const starters = (process.env.AI_STARTERS || 'What is overdue today?|Which projects need my attention?|How much is outstanding by customer?|What is the status of AB-1005?').split('|');
  const { token } = await signIn('manager');
  for (const q of starters) {
    const res = await fetch(`${BASE}/api/assistant/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `token=${token}; demo_lead=us-scan` },
      body: JSON.stringify({ messages: [{ role: 'user', content: q }] }) });
    if (!res.ok) { console.log(`ai: "${q}" HTTP ${res.status} (no AI key on this server?), answer not checked`); continue; }
    report(`ai answer "${q}"`, await res.text());
  }
}

const INTERNAL_TABLES = new Set(['usb_audit', 'counters', 'action_permissions', 'app_settings', 'audit_log', 'schema_migrations']);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (want('db')) await scanDb();
  if (want('bundle')) scanBundle();
  const pdfLinks = new Set();
  if (want('pages')) await scanPages(pdfLinks);
  if (want('pdfs')) await scanPdfs(pdfLinks);
  if (want('ai')) await scanAi();
  if (DUMP) { const { writeFileSync } = await import('node:fs'); writeFileSync(DUMP, JSON.stringify(dump, null, 1)); console.log(`dump: ${Object.keys(dump).length} entries -> ${DUMP}`); }
  console.log(`\n${hits} hit(s)`);
  process.exit(hits ? 1 : 0);
}
