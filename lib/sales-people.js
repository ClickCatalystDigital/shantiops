// lib/sales-people.js — server side of Sales CRM plan 1i (lib/sales-people.mjs is the pure half).
// A new A/C manager / Sales Person value must be an active Sales user's username. Keeping the value
// a record already has is always allowed, and — for sale orders only — so is a legacy name already
// in use on other imported orders, so the 1,006 imported orders can still be moved between the
// names they were imported with. Anything else is refused rather than stored as a new spelling.
import { queryAll, queryOne } from '@/lib/db';
import { parseDepartments } from '@/lib/auth';

export async function getSalesUsers() {
  const rows = await queryAll("SELECT username, display_name, departments FROM users WHERE active = 1 AND pending = 0 AND role = 'operator'");
  return rows.filter(r => parseDepartments(r.departments).includes('Sales')).map(r => ({ username: r.username, display_name: r.display_name }));
}

// Returns { value } (the value to store — trimmed, or null for blank) or { error }.
export async function checkSalesPerson(raw, { current = null, allowLegacy = false, label = 'A/C Manager' } = {}) {
  const v = String(raw ?? '').trim();
  if (!v) return { value: null };
  if (current != null && v === String(current).trim()) return { value: v };
  const users = await getSalesUsers();
  if (users.some(u => u.username === v)) return { value: v };
  if (allowLegacy) {
    const used = await queryOne('SELECT 1 AS ok FROM sale_orders WHERE sales_person_override = ? LIMIT 1', [v]);
    if (used) return { value: v };
  }
  return { error: `${label} must be an active Sales user (got "${v}")` };
}
