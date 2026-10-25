// Public demo only: visitors' contact details, kept in their own database (LEADS_TURSO_URL) so the
// nightly reset of the demo data never touches them. Read them with: turso db shell sb-demo-leads
// Each lead gets a token (the demo_lead cookie) that also counts its free AI questions.
import { createClient } from '@libsql/client/web';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

// Free Ember AI questions per visitor (one lead form). Then the widget locks and points them to us.
export const DEMO_AI_QUESTIONS = 2;

// Owner pass: a short PIN (the Worker secret DEMO_PASS, 4+ characters), typed under "Have a demo pass?" on /demo or
// opened as /demo#pass=<PIN>. /api/demo/pass trades it for a demo_lead cookie holding an HMAC of the PIN (never the PIN
// itself): that browser skips the form, is never saved as a lead, and asks Ember AI without a limit. A short PIN is
// guessable, so wrong tries are capped: 5 per visitor IP and 200 in all per day. No DEMO_PASS, no pass.
// Same as savistar-ops and reel-inventory.
const passKey = () => (process.env.DEMO_PASS?.length >= 4 ? process.env.DEMO_PASS : null);
const PASS_TRIES_PER_IP = 5, PASS_TRIES_PER_DAY = 200;
const utcDay = () => new Date().toISOString().slice(0, 10);
export async function passLocked(ip) {
  const r = await (await leads()).execute({ sql: 'SELECT COALESCE(SUM(n), 0) AS total, COALESCE(SUM(CASE WHEN ip = ? THEN n END), 0) AS mine FROM demo_pass_tries WHERE day = ?', args: [ip, utcDay()] });
  return Number(r.rows[0].mine) >= PASS_TRIES_PER_IP || Number(r.rows[0].total) >= PASS_TRIES_PER_DAY;
}
export async function passFailed(ip) {
  await (await leads()).execute({ sql: 'INSERT INTO demo_pass_tries (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1', args: [ip, utcDay()] });
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
export const ownerPassToken = () => (passKey() ? `pass.${createHmac('sha256', passKey()).update('demo-owner-pass').digest('base64url')}` : null);
export const passMatches = (given) => !!passKey() && typeof given === 'string' && same(given, passKey());
export const isOwnerPass = (token) => !!ownerPassToken() && !!token && same(token, ownerPassToken());

let client = null;
let ready = null;
function db() {
  if (!process.env.LEADS_TURSO_URL) throw new Error('LEADS_TURSO_URL is not set');
  client ||= createClient({ url: process.env.LEADS_TURSO_URL, authToken: process.env.LEADS_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
  return client;
}
// The table and its AI columns, once per server start (cleared on failure so the next request retries).
function leads() {
  ready ||= (async () => {
    const c = db();
    await c.execute(`CREATE TABLE IF NOT EXISTS demo_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT, manufactures TEXT, ip TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    for (const col of ['token TEXT', 'ai_used INTEGER NOT NULL DEFAULT 0']) {
      await c.execute(`ALTER TABLE demo_leads ADD COLUMN ${col}`).catch(() => {}); // already there
    }
    // wrong owner-pass tries, per visitor IP per day (passLocked below)
    await c.execute('CREATE TABLE IF NOT EXISTS demo_pass_tries (ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip, day))');
    return c;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// Returns the new lead's token.
export async function saveDemoLead({ name, company, email, phone, manufactures, ip, userAgent }) {
  const token = randomBytes(18).toString('base64url');
  await (await leads()).execute({
    sql: 'INSERT INTO demo_leads (name, company, email, phone, manufactures, ip, user_agent, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [name, company, email, phone || null, manufactures || null, ip || null, userAgent || null, token],
  });
  return token;
}

// Older visitors' cookie is '1' (before tokens): they can still enter, but get no AI questions.
const valid = (token) => !!token && token !== '1';

export async function demoAiLeft(token) {
  if (isOwnerPass(token)) return DEMO_AI_QUESTIONS; // shown as "no limit"
  if (!valid(token)) return 0;
  const r = await (await leads()).execute({ sql: 'SELECT ai_used FROM demo_leads WHERE token = ?', args: [token] });
  return r.rows.length ? Math.max(0, DEMO_AI_QUESTIONS - Number(r.rows[0].ai_used)) : 0;
}
// Takes one question atomically; false when none are left.
export async function takeDemoAiQuestion(token) {
  if (isOwnerPass(token)) return true;
  if (!valid(token)) return false;
  const r = await (await leads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used + 1 WHERE token = ? AND ai_used < ?', args: [token, DEMO_AI_QUESTIONS] });
  return r.rowsAffected === 1;
}
// Gives it back when the answer failed, so a visitor never loses one to an error.
export async function returnDemoAiQuestion(token) {
  if (valid(token) && !isOwnerPass(token)) await (await leads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used - 1 WHERE token = ? AND ai_used > 0', args: [token] });
}

// Emails the lead to us through ahromlabs.com (its /api/demo-lead, shared DEMO_LEAD_KEY). Never blocks or
// fails the visitor's entry: the lead is already saved, so a mail problem is only logged.
export async function emailDemoLead(lead) {
  if (!process.env.DEMO_LEAD_KEY) return;
  try {
    const res = await fetch('https://ahromlabs.com/api/demo-lead', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', 'x-demo-key': process.env.DEMO_LEAD_KEY },
      body: JSON.stringify({ demo: 'boiler', name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, about: lead.manufactures }),
    });
    if (!res.ok) console.error('demo lead email failed', res.status);
  } catch (e) { console.error('demo lead email failed', e.message); }
}
