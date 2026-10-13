// Public demo only: visitors' contact details, kept in their own database (LEADS_TURSO_URL) so the
// nightly reset of the demo data never touches them. Read them with: turso db shell sb-demo-leads
// Each lead gets a token (the demo_lead cookie) that also counts its free AI questions.
import { createClient } from '@libsql/client/web';
import { randomBytes } from 'node:crypto';

// Free OPS AI questions per visitor (one lead form). Then the widget locks and points them to us.
export const DEMO_AI_QUESTIONS = 2;

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
  if (!valid(token)) return 0;
  const r = await (await leads()).execute({ sql: 'SELECT ai_used FROM demo_leads WHERE token = ?', args: [token] });
  return r.rows.length ? Math.max(0, DEMO_AI_QUESTIONS - Number(r.rows[0].ai_used)) : 0;
}
// Takes one question atomically; false when none are left.
export async function takeDemoAiQuestion(token) {
  if (!valid(token)) return false;
  const r = await (await leads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used + 1 WHERE token = ? AND ai_used < ?', args: [token, DEMO_AI_QUESTIONS] });
  return r.rowsAffected === 1;
}
// Gives it back when the answer failed, so a visitor never loses one to an error.
export async function returnDemoAiQuestion(token) {
  if (valid(token)) await (await leads()).execute({ sql: 'UPDATE demo_leads SET ai_used = ai_used - 1 WHERE token = ? AND ai_used > 0', args: [token] });
}
