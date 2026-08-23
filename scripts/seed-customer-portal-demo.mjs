// scripts/seed-customer-portal-demo.mjs — gives every remaining demo customer a working Customer
// Portal login (2026-08-23), same simple-password convention as the three original demo logins
// (asian_brown/hkm_charitable/virchow_biotech, lib/db.js's seedIfEmpty) — NOT the random-password +
// email-setup-link flow real customers go through (POST /api/customers/[id]/portal). That flow
// requires a working mail provider to ever flip portal_enabled; these are purely for live-demo
// access. All 12 customers in this DB use reserved .example email addresses (RFC 2606, permanently
// non-routable) — confirmed real business data has never touched this table.
//
// Deliberately leaves customers.portal_enabled = 0: that flag is the "send/attempt email" trigger,
// not an access gate — a customer's own login already works purely from having a `users` row with
// role='customer' and the right project_ids. This script "keeps the portal alive" without ever
// sending anything, on request (see SYSTEM.md §5al).
//
// Idempotent: skips any customer that already has customers.portal_user_id set.
// Run: node --env-file=.env.local scripts/seed-customer-portal-demo.mjs
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function main() {
  const customers = (await db.execute(
    "SELECT id, name FROM customers WHERE portal_user_id IS NULL AND email LIKE '%.example'"
  )).rows;

  for (const c of customers) {
    const projects = (await db.execute({
      sql: 'SELECT id FROM projects WHERE customer_id = ? OR customer_name = ?', args: [c.id, c.name],
    })).rows;
    if (!projects.length) { console.log(`skip ${c.name} — no projects`); continue; }
    const projectIds = [...new Set(projects.map(p => String(p.id)))].join(',');

    let username = slugify(c.name) || `customer_${c.id}`;
    let candidate = username, n = 1;
    while ((await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [candidate] })).rows.length) {
      candidate = `${username}${++n}`;
    }
    username = candidate;
    const password = `${username}123`;

    const r = await db.execute({
      sql: `INSERT INTO users (username, password, role, display_name, project_ids) VALUES (?, ?, 'customer', ?, ?)`,
      args: [username, bcrypt.hashSync(password, 10), c.name, projectIds],
    });
    const userId = Number(r.lastInsertRowid);
    await db.execute({ sql: 'UPDATE customers SET portal_user_id = ? WHERE id = ?', args: [userId, c.id] });
    console.log(`${c.name} -> ${username} / ${password}  (projects: ${projectIds})`);
  }
}

main();
