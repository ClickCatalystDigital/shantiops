// scripts/create-sales-employee-accounts.mjs — real Sales department logins for the salespeople
// named across the historical order register / A/c Manager fields (display_name is kept byte-for-
// byte identical to how each name appears in that historical data — including the real "Hyderabd"
// typo — so lib/sales-people.mjs's exact-text matching picks up every past order/enquiry for free).
// Usage:
//   node --env-file=.env.local scripts/create-sales-employee-accounts.mjs            # dry run
//   node --env-file=.env.local scripts/create-sales-employee-accounts.mjs --apply
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const MANIFEST = path.resolve('scripts/data/sales-employee-accounts-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));

// [username, display_name (exact legacy text), designation]
const PEOPLE = [
  ['srivaari', 'Srivaari', 'Director'],
  ['amit_b', 'Amit B', 'Director'],
  ['sales_desk2', 'Sales Desk2', 'Incharge - Business Development'],
  ['sales_desk', 'Sales Desk', 'Incharge - Business Development'],
  ['devansh_trivedi', 'DevanshTrivedi', 'Director'],
  ['sales2', 'Sales2', 'Manager Marketing'],
  ['bdm_hyderabad', 'BDM Hyderabd', 'Manager Marketing'], // "Hyderabd" typo kept on purpose — matches historical data
  ['bdm_siliguri', 'BDM-Siliguri', 'Sales Executive'],
  ['bdm_ap_ts', 'BDM-AP-TS', 'Sales Executive'],
  ['sales1', 'Sales1', 'Sales Executive'],
  ['bdm_ne', 'BDM-NE', 'Sales Executive'],
  ['bdm_kolkata', 'BDM-KOLKATA', 'Sales Executive'],
  ['bdm_up', 'BDM-UP', 'Sales Executive'],
];

const randomPassword = () => Array.from({ length: 10 }, () =>
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 55)]
).join('');

const existing = await q('SELECT username FROM users');
const existingSet = new Set(existing.map(u => u.username.toLowerCase()));

const toCreate = PEOPLE.filter(([username]) => !existingSet.has(username.toLowerCase()));
const skipped = PEOPLE.filter(([username]) => existingSet.has(username.toLowerCase()));

console.log(`${toCreate.length} accounts to create, ${skipped.length} already exist (skipped): ${skipped.map(s => s[0]).join(', ') || 'none'}`);

if (!APPLY) {
  console.log('\nDry run — pass --apply to write. Will create:');
  for (const [u, d, r] of toCreate) console.log(`  ${u} — "${d}" (${r})`);
  process.exit(0);
}

const created = [];
for (const [username, displayName, designation] of toCreate) {
  const password = randomPassword();
  const res = await db.execute({
    sql: `INSERT INTO users (username, password, role, display_name, departments, active) VALUES (?, ?, 'operator', ?, 'Sales', 1)`,
    args: [username, bcrypt.hashSync(password, 10), displayName],
  });
  created.push({ id: Number(res.lastInsertRowid), username, displayName, designation, password });
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ created: created.map(({ password, ...rest }) => rest) }, null, 2));

console.log(`\ncreated ${created.length} accounts:\n`);
for (const c of created) console.log(`  ${c.username} / ${c.password}  — "${c.displayName}" (${c.designation})`);
console.log(`\n(passwords are NOT stored anywhere except this output — hand them out and have each person change it. Manifest (no passwords): ${MANIFEST})`);
db.close();
