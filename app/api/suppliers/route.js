// app/api/suppliers/route.js

// Provisional suppliers table (§5a) — the client's real supplier list is coming separately and
// will be mapped onto this additively. UNIQUE(name) exists specifically so "Kirloskar" and
// "Kirloskar Bros" can't drift into two rows before that happens.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { getSuppliers } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getSuppliers());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Supplier name is required' }, { status: 400 });

  try {
    const { lastId } = await execute(
      `INSERT INTO suppliers (name, gst_no, contact_person, phone, email, address, default_payment_terms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, b.gst_no || null, b.contact_person || null, b.phone || null, b.email || null,
        b.address || null, b.default_payment_terms || null]
    );
    await audit('supplier_created', { actor: user.username, detail: name });
    return NextResponse.json({ id: Number(lastId) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json({ error: 'A supplier with that name already exists' }, { status: 409 });
    }
    throw e;
  }
}
