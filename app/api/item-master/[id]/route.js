// app/api/item-master/[id]/route.js — single-record read (with real usage counts, so an edit isn't
// made blind to how widely-shared this catalog row already is) + edit. item_code/id/created_at are
// never accepted on PATCH — immutable once created, same convention this file's sibling route
// establishes at creation time.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { CATEGORY_LABEL } from '@/lib/section-shapes';

const NUMERIC_FIELDS = ['cqty', 'cfactor', 'min_qty', 'max_qty', 'lead_time', 'tolerance_plus', 'tolerance_minus', 'hsn_item_pct'];
const EDITABLE_FIELDS = [
  'item_name', 'category', 'bom_category', 'group_name', 'main_group', 'sub_group', 'group_code',
  'detail_desc', 'drg_no', 'drg_rev', 'part_no', 'uom', 'cqty', 'cfactor', 'conv_uom',
  'material_process_type', 'item_type', 'min_qty', 'max_qty', 'lead_time', 'tolerance_plus',
  'tolerance_minus', 'class', 'store_location', 'bin_no', 'hsn_code', 'hsn_desc', 'hsn_item_pct',
  'default_requires_heat_no', 'default_requires_mtc', 'default_requires_supplier_batch', 'default_requires_serial_no',
];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.item_master.write');
  if (denied) return denied;

  const item = await queryOne('SELECT * FROM items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [bomUsage, invUsage] = await Promise.all([
    queryOne('SELECT COUNT(*) AS lines, COUNT(DISTINCT project_id) AS projects FROM bom_items WHERE item_id = ?', [params.id]),
    queryOne('SELECT COUNT(*) AS lines FROM inventory_items WHERE item_id = ?', [params.id]),
  ]);

  return NextResponse.json({
    ...item,
    usage: { bom_lines: bomUsage.lines, bom_projects: bomUsage.projects, inventory_lines: invUsage.lines },
  });
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.item_master.write');
  if (denied) return denied;

  const existing = await queryOne('SELECT id, item_name FROM items WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if ('item_name' in b && !String(b.item_name || '').trim()) {
    return NextResponse.json({ error: 'Item Name is required' }, { status: 400 });
  }
  for (const f of NUMERIC_FIELDS) {
    const v = b[f];
    if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
      return NextResponse.json({ error: `${f.replace(/_/g, ' ')} must be a number` }, { status: 400 });
    }
  }
  if (b.bom_category && !(b.bom_category in CATEGORY_LABEL)) {
    return NextResponse.json({ error: 'Invalid BOM category' }, { status: 400 });
  }

  const cols = EDITABLE_FIELDS.filter(f => f in b);
  if (!cols.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await execute(
    `UPDATE items SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map(f => (b[f] === '' ? null : b[f])), params.id]
  );

  await audit('item_master_edit', { actor: user.username, detail: JSON.stringify({ id: Number(params.id), item_name: existing.item_name, changed: cols }) });
  return NextResponse.json({ ok: true });
}
