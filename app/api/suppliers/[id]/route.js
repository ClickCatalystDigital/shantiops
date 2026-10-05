import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const FIELDS = ['name', 'gst_no', 'contact_person', 'phone', 'email', 'address', 'default_payment_terms', 'active'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const supplier = await queryOne('SELECT * FROM suppliers WHERE id = ?', [params.id]);
  if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  // Deactivate is its own action from the UI's own dedicated button (components/
  // ProcurementWorkspace.jsx's deactivate()) and sends body:{active:false} alone — anything else
  // (name/gst/contact edits) is the general supplier.write action, even if 'active' rides along.
  const isDeactivateOnly = Object.keys(b).length === 1 && 'active' in b && !b.active;
  const actionDenied = await requireAction(user, 'Procurement', isDeactivateOnly ? 'procurement.supplier.deactivate' : 'procurement.supplier.write');
  if (actionDenied) return actionDenied;
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

// Delete a supplier. Never used anywhere (no quote, RFQ, PO, bill…) = removed for good. Used = kept
// for history and deactivated instead (it leaves the roster and every picker). The tables that point
// at suppliers are read from the live schema, so a new one is covered without touching this file.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement') || await requireAction(user, 'Procurement', 'procurement.supplier.deactivate');
  if (denied) return denied;
  const supplier = await queryOne('SELECT * FROM suppliers WHERE id = ?', [params.id]);
  if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const refs = await queryAll(
    `SELECT m.name AS tbl, f."from" AS col FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
      WHERE m.type = 'table' AND f."table" = 'suppliers'`);
  let used = false;
  for (const r of refs) {
    if (await queryOne(`SELECT 1 FROM "${r.tbl}" WHERE "${r.col}" = ? LIMIT 1`, [supplier.id])) { used = true; break; }
  }
  if (!used) {
    try { await execute('DELETE FROM suppliers WHERE id = ?', [supplier.id]); }
    catch (e) { if (!String(e.message).includes('FOREIGN KEY')) throw e; used = true; } // raced with a new reference
  }
  if (used) await execute('UPDATE suppliers SET active = 0 WHERE id = ?', [supplier.id]);
  await audit(used ? 'supplier_deactivated' : 'supplier_deleted', { actor: user.username, detail: `supplier ${supplier.id}: ${supplier.name}` });
  return NextResponse.json({ ok: true, deleted: !used });
}
