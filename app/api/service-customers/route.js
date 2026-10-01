// Customer search for the Service expense forms: real customers + "other" (third-party) names
// that earlier forms registered. POST registers a new third-party name.
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const allowed = user => user && canAccessDepartment(user, 'Installation');

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!allowed(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const q = (new URL(req.url).searchParams.get('search') || '').trim();
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
  const name = String((await req.json()).name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  await execute('INSERT OR IGNORE INTO service_third_party_customers (name, created_by) VALUES (?, ?)', [name, user.username]);
  return NextResponse.json({ type: 'other', name });
}
