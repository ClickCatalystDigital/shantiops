// Public demo: copy the client's Sales Product Master (cleaned of every client name) and create the
// demo customer login (Greenfield Foods, AB-1005) used by the "Customer" role on /demo.
// Writes to every DB URL given. Idempotent: existing product codes and the login are left alone.
//
//   SRC_URL=… SRC_TOKEN=… DB_TOKEN=… node scripts/demo/add-shop-demo.mjs <golden url> [<live url> …] [--apply]
//
// Not copied: price, cost price (the client's price list must not be public), old-CRM attributes,
// photos, BOM template links. Without --apply it only reports.
// Every Shop family also gets a stock photo (public/shop-demo/<group>.webp, AI-generated
// for the demo; no real product). Without SRC_URL only the photos are set.
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { DENY, DENY_WORDS } from './deny-list.mjs';
import { shopGroupOf, HIDDEN, SHOP_GROUPS } from '../../lib/shop-catalog.mjs';

const apply = process.argv.includes('--apply');
const targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!targets.length) { console.error('DB_TOKEN and at least one target URL are required (SRC_URL/SRC_TOKEN to copy products)'); process.exit(1); }

export const CUSTOMER_LOGIN = { username: 'greenfield_foods', project_no: 'AB-1005', customer: 'Greenfield Foods Pvt Ltd' };

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const denyRe = new RegExp([...DENY.map(esc), ...DENY_WORDS.map(w => `\\b${esc(w)}\\b`)].join('|'), 'i');

// Boiler families get the generic names the Shop also understands (lib/shop-catalog.mjs).
const TYPES = { 'SOLID-FLAME': 'Solid Fuel', 'SOLID FLAME': 'Solid Fuel', 'COMBI-FLAME': 'Combination Fuel', 'COMBI FLAME': 'Combination Fuel',
  'MULTI-FLAME': 'Multi Fuel', 'MULTI FLAME': 'Multi Fuel', 'OIL-FLAME': 'Oil Fuel', 'OIL FLAME': 'Oil Fuel',
  'GAS-FLAME': 'Gas Fuel', 'GAS FLAME': 'Gas Fuel', 'AGRO-FLAME': 'Agro Fuel', 'AGRO FLAME': 'Agro Fuel' };
const FAMILY = { solid: 'Solid Fuel', combi: 'Combination Fuel', multi: 'Multi Fuel', oil: 'Oil Fuel', gas: 'Gas Fuel', agro: 'Agro Fuel' };
const REPL = [
  [/\b(solid|combi|multi|oil|gas|agro)[- ]?flame/gi, (_, f) => FAMILY[f.toLowerCase()]],
  [/shanti\s*boilers?(\s*&\s*pressure\s*vessels)?(\s*\(p\))?(\s*(pvt\.?|private))?(\s*(ltd\.?|limited))?/gi, 'Acme Boilers'],
  [/shanti\s*techno\s*fab(\s*(pvt\.?|private))?(\s*(ltd\.?|limited))?/gi, 'Acme Boilers'],
  [/shantiboilers/gi, 'acmeboilers'], [/shanti|srivaari/gi, 'Acme'],
  [/\bSTF-IBR/gi, 'AB-IBR'], [/\b(SBH|STF|SBPV)\b/g, 'AB'], [/\bSB-/g, 'AB-'], [/\bHKM\b/gi, 'customer'],
  [/36AA[A-Z0-9]{11}|AA[EV]CS\d{4}[A-Z]/g, ''],
  [/nacharam|kucharam|kuncharam|toopran/gi, 'Pune'], [/telangana/gi, 'Maharashtra'], [/hyderabad/gi, 'Pune'],
];
export function clean(s) {
  if (s == null) return s;
  let t = String(s);
  for (const [re, to] of REPL) t = t.replace(re, to);
  return t;
}
const cleanType = t => (t == null ? t : TYPES[String(t).trim().toUpperCase()] || clean(t));

const rows = !process.env.SRC_URL ? [] : (await createClient({ url: process.env.SRC_URL, authToken: process.env.SRC_TOKEN }).execute(`SELECT product_code, product_name, product_type, description, unit, hsn_code, gst_pct,
  category, warranty_days, serviceable FROM sales_products WHERE active = 1 ORDER BY id`)).rows;
const products = rows.map(r => ({
  product_code: clean(r.product_code), product_name: clean(r.product_name), product_type: cleanType(r.product_type),
  description: clean(r.description), unit: r.unit, hsn_code: r.hsn_code, gst_pct: r.gst_pct, category: clean(r.category),
  warranty_days: r.warranty_days, serviceable: r.serviceable,
}));
const leaks = products.filter(p => ['product_code', 'product_name', 'product_type', 'description', 'category'].some(k => p[k] && denyRe.test(p[k])));
if (leaks.length) {
  for (const p of leaks.slice(0, 10)) console.error('still names the client:', p.product_code, p.product_name, (p.description || '').match(denyRe)?.[0]);
  process.exit(1);
}
console.log(`${products.length} products read and cleaned; no client names left`);
// Every product must still land in a Shop family after its type was renamed.
const unmapped = {};
for (const p of products) if (shopGroupOf(p) === null) unmapped[p.product_type] = (unmapped[p.product_type] || 0) + 1;
console.log(`Shop: ${products.filter(p => ![null, HIDDEN].includes(shopGroupOf(p))).length} shown`, Object.keys(unmapped).length ? { unmapped } : '');
for (const p of products.filter(p => /acme/i.test(p.description || '')).slice(0, 2)) console.log('  e.g.', p.product_name, '|', p.description.slice(0, 140).replace(/\s+/g, ' '));

for (const url of targets) {
  const db = createClient({ url, authToken: process.env.DB_TOKEN });
  const have = new Set((await db.execute('SELECT product_code FROM sales_products')).rows.map(r => r.product_code));
  const seen = new Set();
  const add = products.filter(p => { const k = p.product_code; if (k && (have.has(k) || seen.has(k))) return false; if (k) seen.add(k); return true; });
  const proj = (await db.execute('SELECT id, customer_id FROM projects WHERE project_no = ?', [CUSTOMER_LOGIN.project_no])).rows[0];
  const login = (await db.execute('SELECT id FROM users WHERE username = ?', [CUSTOMER_LOGIN.username])).rows[0];
  console.log(`${url.replace(/\/\/([^.]+).*/, '//$1')}: ${add.length} products to add, customer login ${login ? 'exists' : proj ? 'to create' : 'SKIPPED (no ' + CUSTOMER_LOGIN.project_no + ')'}`);
  if (!apply) continue;

  const stmts = add.map(p => ({
    sql: `INSERT INTO sales_products (product_code, product_name, product_type, description, unit, hsn_code, gst_pct, category,
            warranty_days, serviceable, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'demo:client-products')`,
    args: [p.product_code, p.product_name, p.product_type, p.description, p.unit, p.hsn_code, p.gst_pct, p.category, p.warranty_days, p.serviceable],
  }));
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200), 'write');

  if (!login && proj) {
    const hash = await bcrypt.hash(randomBytes(18).toString('hex'), 10); // never used: /demo signs in without a password
    const r = await db.execute(`INSERT INTO users (username, password, role, display_name, project_ids, active, pending, safe_pass, must_change_password)
      VALUES (?, ?, 'customer', ?, ?, 1, 0, 1, 0)`, [CUSTOMER_LOGIN.username, hash, CUSTOMER_LOGIN.customer, String(proj.id)]);
    await db.execute('UPDATE customers SET portal_user_id = ? WHERE id = ?', [Number(r.lastInsertRowid), proj.customer_id]);
  }
  await db.batch(SHOP_GROUPS.map(g => ({
    sql: `INSERT INTO shop_group_images (group_key, image_key, updated_by, updated_at) VALUES (?, ?, 'demo:shop-photos', CURRENT_TIMESTAMP)
          ON CONFLICT(group_key) DO UPDATE SET image_key = excluded.image_key`, args: [g.key, `/shop-demo/${g.key}.webp`] })), 'write');
  console.log(`  done (${SHOP_GROUPS.length} family photos)`);
}
