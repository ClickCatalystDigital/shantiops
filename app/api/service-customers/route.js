// Customer search for the Service expense forms: real customers + "other" (third-party) names
// that earlier forms registered. POST registers a new third-party name.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const allowed = user => user && canAccessDepartment(user, 'Installation');

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  // ?others=1 → the service-only customer list with contact details (Documentation's customer picker).
  if (sp.get('others')) return NextResponse.json(await queryAll('SELECT id, name, contact_person, phone, email, address FROM service_third_party_customers ORDER BY name'));
  const q = (sp.get('search') || '').trim();
  const like = `%${q}%`;
  const [db, other] = await Promise.all([
    queryAll(`SELECT id, name, party_code FROM customers WHERE active = 1 AND (name LIKE ? OR party_code LIKE ?) ORDER BY name LIMIT 15`, [like, like]),
    queryAll(`SELECT id, name FROM service_third_party_customers WHERE name LIKE ? ORDER BY name LIMIT 10`, [like]),
  ]);
  return NextResponse.json([
    ...db.map(c => ({ type: 'db', id: c.id, name: c.name, label: c.party_code ? `${c.name} · ${c.party_code}` : c.name })),
    ...other.map(c => ({ type: 'other', id: c.id, name: c.name, label: `${c.name} (other)` })),
  ]);
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || '').trim().slice(0, 200);
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const t = (k, n = 300) => String(b[k] ?? '').trim().slice(0, n) || null;
  const det = [t('contact_person', 120), t('phone', 20), t('email', 120), t('address', 500)];
  await execute('INSERT OR IGNORE INTO service_third_party_customers (name, created_by) VALUES (?, ?)', [name, user.username]);
  // Details only fill blanks, so an existing customer's details are never overwritten from here.
  await execute(`UPDATE service_third_party_customers SET contact_person = COALESCE(contact_person, ?), phone = COALESCE(phone, ?),
    email = COALESCE(email, ?), address = COALESCE(address, ?) WHERE name = ?`, [...det, name]);
  const row = await queryOne('SELECT id, name, contact_person, phone, email, address FROM service_third_party_customers WHERE name = ?', [name]);
  return NextResponse.json({ type: 'other', ...row });
}
