import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { editableBomFields, PURCHASE_STATUSES } from '@/lib/bom-fields.mjs';

// Field-level department scoping — the trust boundary of the PMB module. A head may only write
// the columns their department owns (BOM_FIELD_OWNERS); a PM writes anything. Enforced here, not
// in the UI, so a forged request from devtools gets a 403 naming the offending keys.
export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const allowed = editableBomFields(user);
  if (!allowed.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b);
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  const denied = keys.filter(k => !allowed.includes(k));
  if (denied.length) {
    return NextResponse.json(
      { error: `Not editable by your department: ${denied.join(', ')}` }, { status: 403 });
  }
  if (keys.includes('material_description') && !String(b.material_description || '').trim()) {
    return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 });
  }
  // V2-CHANGES.md D4 (Phase 5.0): purchase_status is now a mixed-case enum (Enquiry/Comparison/
  // Ordered/Transit/Received/Cancelled/In-Stock) — no more blind .toUpperCase(), validate against
  // the known list instead so a bad value 400s here rather than landing as silent junk.
  if (keys.includes('purchase_status') && b.purchase_status && !PURCHASE_STATUSES.includes(b.purchase_status)) {
    return NextResponse.json({ error: `Unknown purchase_status: ${b.purchase_status}` }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE bom_items SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  await audit('bom_item_edit', {
    actor: user.username,
    detail: JSON.stringify({ bom_item_id: Number(params.id), project_id: item.project_id, changed }),
  });
  return NextResponse.json({ ok: true });
}

// Deleting a BOM row is an Engineering call (it un-defines a material). Rows already carried onto
// a packing list are protected — deleting them would orphan the reconciliation history.
export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const deniedResp = requireDepartment(user, 'Engineering');
  if (deniedResp) return deniedResp;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const packed = await queryOne(
    'SELECT COUNT(*) AS n FROM packing_items WHERE bom_item_id = ?', [params.id]);
  if (packed.n > 0) {
    return NextResponse.json(
      { error: 'This item is on a packing list — remove it there first' }, { status: 409 });
  }

  await execute('DELETE FROM bom_items WHERE id = ?', [params.id]);
  await audit('bom_item_delete', {
    actor: user.username,
    detail: JSON.stringify({
      bom_item_id: Number(params.id), project_id: item.project_id,
      description: item.material_description,
    }),
  });
  return NextResponse.json({ ok: true });
}
