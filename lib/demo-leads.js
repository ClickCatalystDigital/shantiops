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

// Guest pass: a second PIN (the Worker secret GUEST_PASS, 4+ characters) for people we send the demo to, typed in the same
// "Have a demo pass?" box or opened as /demo#pass=<PIN>. It skips the form (no lead saved) and opens the demo in at most
// GUEST_USES browsers per PIN, counted in demo_guests (the nightly reset never touches it); a new PIN starts a fresh count.
// A guest browser is view-only: middleware.js refuses every change while its demo_lead cookie starts with "guest.". It gets
// the visitor's DEMO_AI_QUESTIONS, counted on its demo_guests row. No GUEST_PASS, no guest pass. Same as savistar-ops.
export const GUEST_USES = 5;
const guestKey = () => (process.env.GUEST_PASS?.length >= 4 ? process.env.GUEST_PASS : null);
export const guestPassMatches = (given) => !!guestKey() && typeof given === 'string' && same(given, guestKey());
export const isGuestToken = (token) => typeof token === 'string' && token.startsWith('guest.');
// A new guest browser's token, or null once this PIN has opened GUEST_USES browsers. One statement, so two at once can't
// both take the last use.
export async function takeGuestUse() {
  const token = `guest.${randomBytes(18).toString('base64url')}`;
  const id = createHmac('sha256', guestKey()).update('demo-guest-pass').digest('base64url').slice(0, 16);
  const r = await (await leads()).execute({ sql: 'INSERT INTO demo_guests (token, pass_id) SELECT ?, ? WHERE (SELECT COUNT(*) FROM demo_guests WHERE pass_id = ?) < ?', args: [token, id, id, GUEST_USES] });
  return r.rowsAffected === 1 ? token : null;
}
// Visitors' questions are counted on their lead row, guests' on their demo_guests row.
const aiTable = (token) => (isGuestToken(token) ? 'demo_guests' : 'demo_leads');

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
    // guest-pass browsers (takeGuestUse above); pass_id tells one GUEST_PASS from the next
    await c.execute('CREATE TABLE IF NOT EXISTS demo_guests (token TEXT PRIMARY KEY, pass_id TEXT NOT NULL, ai_used INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
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
  const r = await (await leads()).execute({ sql: `SELECT ai_used FROM ${aiTable(token)} WHERE token = ?`, args: [token] });
  return r.rows.length ? Math.max(0, DEMO_AI_QUESTIONS - Number(r.rows[0].ai_used)) : 0;
}
// Takes one question atomically; false when none are left.
export async function takeDemoAiQuestion(token) {
  if (isOwnerPass(token)) return true;
  if (!valid(token)) return false;
  const r = await (await leads()).execute({ sql: `UPDATE ${aiTable(token)} SET ai_used = ai_used + 1 WHERE token = ? AND ai_used < ?`, args: [token, DEMO_AI_QUESTIONS] });
  return r.rowsAffected === 1;
}
// Gives it back when the answer failed, so a visitor never loses one to an error.
export async function returnDemoAiQuestion(token) {
  if (valid(token) && !isOwnerPass(token)) await (await leads()).execute({ sql: `UPDATE ${aiTable(token)} SET ai_used = ai_used - 1 WHERE token = ? AND ai_used > 0`, args: [token] });
}

// Emails the lead to us through ahromlabs.com (its /api/demo-lead, shared DEMO_LEAD_KEY), before it is saved here.
// Returns ahromlabs.com's message when it finds the email made up; any other problem is only logged, never blocks.
export async function emailDemoLead(lead) {
  if (!process.env.DEMO_LEAD_KEY) return null;
  try {
    const res = await fetch('https://ahromlabs.com/api/demo-lead', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', 'x-demo-key': process.env.DEMO_LEAD_KEY },
      body: JSON.stringify({ demo: 'boiler', name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, about: lead.manufactures, whatsapp_ok: lead.whatsapp_ok === true }),
    });
    // 422: ahromlabs.com found the email made up (no mail server, placeholder, temporary inbox); show its message.
    if (res.status === 422) return (await res.json().catch(() => ({}))).error || 'Please use your real email address.';
    if (!res.ok) console.error('demo lead email failed', res.status);
  } catch (e) { console.error('demo lead email failed', e.message); }
  return null;
}
