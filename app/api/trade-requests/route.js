// Trade Requests — raised by Installation (Requests tab), worked by Sales. Not a PR: no PR number,
// nothing reaches Procurement/Stores.
import { NextResponse } from 'next/server';
import { execute, nextNumber } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getTradeRequests } from '@/lib/data';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !['Sales', 'Installation'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Installation-only users see just their own; Sales/PM see all.
  const all = isPM(user) || canAccessDepartment(user, 'Sales');
  return NextResponse.json(await getTradeRequests(all ? {} : { raisedBy: user.username }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.trade_request.write');
  if (denied) return denied;

  const b = await req.json();
  const description = String(b.material_description || '').trim();
  const qty = String(b.qty_text || '').trim();
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  if (!qty) return NextResponse.json({ error: 'Quantity is required' }, { status: 400 });
  const t = v => String(v || '').trim() || null;

  const trNo = await nextNumber('trade_request_no', 'TR');
  const { lastId } = await execute(
    `INSERT INTO trade_requests (tr_no, material_description, item_id, moc, size_spec, qty_text, project_id, sale_order_no, notes, raised_by, raised_by_dept, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Installation', ?)`,
    [trNo, description, b.item_id ? Number(b.item_id) : null, t(b.moc), t(b.size_spec), qty,
     b.project_id ? Number(b.project_id) : null, t(b.sale_order_no), t(b.notes), user.username, b.meta && typeof b.meta === 'object' ? JSON.stringify(b.meta) : null]
  );
  await audit('trade_request_created', { actor: user.username, detail: `${trNo}: ${description}` });
  // Best effort — Sales hears about it without having to open the tab.
  try { await notifyDepartment('Sales', { kind: 'trade_request', title: `Trade request ${trNo}`, body: `${description} · ${qty}${b.sale_order_no ? ` · ${b.sale_order_no}` : ''}`, dedupe_key: `trade_request:${trNo}` }, { except: user.id }); } catch { /* non-fatal */ }
  return NextResponse.json({ id: Number(lastId), tr_no: trNo });
}
