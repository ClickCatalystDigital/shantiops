// app/api/customers/route.js — V3_CHANGES.md §12 Phase 2a. Activates the previously-orphan
// `customers` table (SYSTEM.md/master-import wrote it, nothing ever read it). Mirrors
// app/api/suppliers/route.js exactly: GET+search, POST, deactivate-never-delete on [id].
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const search = sp.get('search');
  const COLS = 'id, name, party_code, gst_no, phone, city, state_code, account_manager';
  const where = "active = 1 AND (name LIKE ? OR party_code LIKE ? OR gst_no LIKE ? OR phone LIKE ? OR city LIKE ? OR account_manager LIKE ?)";
  // Paged list for the Customers tab: ?paged=1&q=&offset=&limit= -> { rows, total }.
  if (sp.get('paged')) {
    const like = `%${(sp.get('q') || '').trim()}%`;
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 25, 1), 100);
    const offset = Math.max(Number(sp.get('offset')) || 0, 0);
    const args = Array(6).fill(like);
    const [rows, count] = await Promise.all([
      queryAll(`SELECT ${COLS} FROM customers WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`, [...args, limit, offset]),
      queryAll(`SELECT COUNT(*) AS n FROM customers WHERE ${where}`, args),
    ]);
    return NextResponse.json({ rows, total: count[0].n });
  }
  if (search) {
    const like = `%${search.trim()}%`;
    return NextResponse.json(await queryAll(`SELECT ${COLS} FROM customers WHERE ${where} ORDER BY name LIMIT 20`, Array(6).fill(like)));
  }
  return NextResponse.json(await queryAll('SELECT * FROM customers WHERE active = 1 ORDER BY name'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;

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
