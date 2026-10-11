// Public demo only: visitors' contact details, kept in their own database (LEADS_TURSO_URL) so the
// nightly reset of the demo data never touches them. Read them with: turso db shell sb-demo-leads
import { createClient } from '@libsql/client/web';

let client = null;
function db() {
  if (!process.env.LEADS_TURSO_URL) throw new Error('LEADS_TURSO_URL is not set');
  client ||= createClient({ url: process.env.LEADS_TURSO_URL, authToken: process.env.LEADS_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
  return client;
}

export async function saveDemoLead({ name, company, email, phone, manufactures, ip, userAgent }) {
  const c = db();
  await c.execute(`CREATE TABLE IF NOT EXISTS demo_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, manufactures TEXT, ip TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await c.execute({
    sql: 'INSERT INTO demo_leads (name, company, email, phone, manufactures, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [name, company, email, phone || null, manufactures || null, ip || null, userAgent || null],
  });
}
