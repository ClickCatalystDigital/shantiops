// app/api/customers/route.js — V3_CHANGES.md §12 Phase 2a. Activates the previously-orphan
// `customers` table (SYSTEM.md/master-import wrote it, nothing ever read it). Mirrors
// app/api/suppliers/route.js exactly: GET+search, POST, deactivate-never-delete on [id].
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const search = new URL(req.url).searchParams.get('search');
  if (search) {
    const rows = await queryAll(
      "SELECT * FROM customers WHERE active = 1 AND name LIKE ? ORDER BY name LIMIT 20",
      [`%${search}%`]
    );
    return NextResponse.json(rows);
  }
  return NextResponse.json(await queryAll('SELECT * FROM customers WHERE active = 1 ORDER BY name'));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO customers (name, gst_no, phone, email, address, city, state, state_code, pin_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, b.gst_no || null, b.phone || null, b.email || null, b.address || null,
      b.city || null, b.state || null, b.state_code || null, b.pin_code || null]
  );
  await audit('customer_created', { actor: user.username, detail: name });
  return NextResponse.json({ id: Number(lastId) });
}
