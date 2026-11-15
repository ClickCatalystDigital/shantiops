// Public demo: give every customer that has a Sale Order a portal login, so each shows under Customer on /demo.
// The app does this itself for new Sale Orders (lib/portal-invite.js autoEnablePortal); the seeded ones predate it.
// Same shape as Greenfield Foods' login (scripts/demo/add-shop-demo.mjs): random password (never used: /demo signs in
// without one), project_ids = the customer's projects, linked through customers.portal_user_id. Sends nothing.
//   TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/demo/add-customer-logins.mjs [--apply]
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, intMode: 'number' });
if (!(await db.execute("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'")).rows.length) throw new Error('Not a demo database');
const apply = process.argv.includes('--apply');

const rows = (await db.execute(`
  SELECT c.id, c.name, GROUP_CONCAT(DISTINCT p.id) AS project_ids
    FROM customers c
    JOIN sale_orders so ON so.customer_id = c.id AND COALESCE(so.status, '') != 'cancelled' AND so.so_no NOT LIKE 'SAS%'
    LEFT JOIN projects p ON p.customer_id = c.id AND p.is_system = 0
   WHERE c.portal_user_id IS NULL
   GROUP BY c.id`)).rows;

for (const c of rows) {
  const base = c.name.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|co)\b/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  let username = base, n = 2;
  while ((await db.execute('SELECT 1 FROM users WHERE username = ?', [username])).rows.length) username = `${base}_${n++}`;
  console.log(`${apply ? 'create' : 'would create'} ${username} for ${c.name} (projects ${c.project_ids || 'none'})`);
  if (!apply) continue;
  const hash = await bcrypt.hash(randomBytes(18).toString('hex'), 10);
  const r = await db.execute(`INSERT INTO users (username, password, role, display_name, project_ids, active, pending, safe_pass, must_change_password)
    VALUES (?, ?, 'customer', ?, ?, 1, 0, 1, 0)`, [username, hash, c.name, c.project_ids || '']);
  await db.execute('UPDATE customers SET portal_user_id = ? WHERE id = ?', [Number(r.lastInsertRowid), c.id]);
}
if (!rows.length) console.log('every customer with a Sale Order already has a portal login');
