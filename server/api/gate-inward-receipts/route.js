// app/api/gate-inward-receipts/route.js — STERP item 14. Formal Gate Inward Receipt: vehicle,
// supplier, driver, entry time, material reference, and a security check, logged the moment
// something physically enters — before/independent of any GRN. GET is isInternal-gated (same
// reasoning as inventory-items' GET — other departments may need to see what's arrived), writes
// are Stores-only.
import { NextResponse } from 'next/server';
import { execute, nextCounterValue, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getGateInwardReceipts } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (new URL(req.url).searchParams.get('expected')) {
    // Suppliers with goods still due: an issued PO with a line not yet received / closed, plus the
    // latest dispatch the supplier recorded on it (vehicle, invoice) to pre-fill the gate entry.
    const rows = await queryAll(
      `SELECT s.name AS supplier_name, po.id AS po_id, po.po_no,
         (SELECT d.vehicle_no FROM po_dispatches d WHERE d.po_id = po.id ORDER BY d.dispatched_on DESC, d.id DESC LIMIT 1) AS vehicle_no,
         (SELECT d.invoice_no FROM po_dispatches d WHERE d.po_id = po.id ORDER BY d.dispatched_on DESC, d.id DESC LIMIT 1) AS invoice_no,
         (SELECT MIN(d.expected_delivery_date) FROM po_dispatches d WHERE d.po_id = po.id) AS expected_on
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status = 'issued' AND EXISTS (
         SELECT 1 FROM po_items pi JOIN bom_items b ON b.id = pi.bom_item_id
         WHERE pi.po_id = po.id AND COALESCE(b.purchase_status, '') NOT IN ('Received','In-Stock','Cancelled','CLOSED'))
       ORDER BY s.name, po.issued_at DESC`);
    const bySupplier = new Map();
    for (const r of rows) {
      const e = bySupplier.get(r.supplier_name) || { supplier_name: r.supplier_name, pos: [] };
      e.pos.push({ po_no: r.po_no, vehicle_no: r.vehicle_no, invoice_no: r.invoice_no, expected_on: r.expected_on });
      bySupplier.set(r.supplier_name, e);
    }
    return NextResponse.json([...bySupplier.values()]);
  }
  return NextResponse.json(await getGateInwardReceipts());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.gir.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!String(b.vehicle_no || '').trim() && !String(b.supplier_name || '').trim()) {
    return NextResponse.json({ error: 'Enter at least a vehicle number or a supplier' }, { status: 400 });
  }
  const girNo = await nextCounterValue('gir_no');
  const { lastId } = await execute(
    `INSERT INTO gate_inward_receipts
       (gir_no, vehicle_no, supplier_name, driver_name, material_ref,
        security_seal_ok, security_docs_ok, security_remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [girNo, b.vehicle_no || null, b.supplier_name || null, b.driver_name || null, b.material_ref || null,
      b.security_seal_ok ? 1 : 0, b.security_docs_ok ? 1 : 0, b.security_remarks || null, user.username]
  );
  await audit('gir_created', { actor: user.username, detail: `GIR-${girNo}: ${b.supplier_name || ''} / ${b.vehicle_no || ''}` });
  return NextResponse.json({ id: Number(lastId), gir_no: girNo });
}
