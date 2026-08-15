import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const FIELDS = ['name', 'gst_no', 'contact_person', 'phone', 'email', 'address', 'default_payment_terms', 'active'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const supplier = await queryOne('SELECT * FROM suppliers WHERE id = ?', [params.id]);
  if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(f === 'active' ? (b[f] ? 1 : 0) : (b[f] || null)); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);

  try {
    await execute(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, args);
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json({ error: 'A supplier with that name already exists' }, { status: 409 });
    }
    throw e;
  }
  await audit('supplier_edit', { actor: user.username, detail: `supplier ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
