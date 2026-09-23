// app/api/procurement/custom-items/route.js — Procurement's own "Add Item," for material that
// isn't linked to any PMB import or Purchase Requisition. Reuses the existing bom_items.source
// column (already 'bom'|'stock'|'sas') with a new value, 'custom', rather than a schema change —
// getSourcingItems()'s existing `b.source != 'bom'` exemption already skips the release_bom gate
// for any non-'bom' source, exactly the behavior a project-independent custom item needs.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { CATEGORY_LABEL } from '@/lib/section-shapes';
import { learnCategoryIfConfirmed } from '@/lib/category-learning';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.custom_item.add');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!String(b.material_description || '').trim()) {
    return NextResponse.json({ error: 'A description is required' }, { status: 400 });
  }
  if (b.category && !Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, b.category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  // Optionally link to a real project; otherwise the sentinel system project (same "no project"
  // idiom source='stock'/'sas' items already use, V2-CHANGES.md Group 6 Phase 6.4).
  let projectId = b.project_id ? Number(b.project_id) : null;
  if (projectId) {
    const project = await queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  } else {
    const sentinel = await queryOne('SELECT id FROM projects WHERE is_system = 1 LIMIT 1');
    projectId = sentinel.id;
  }

  const category = b.category && CATEGORY_LABEL[b.category] ? b.category : null;
  const categoryFieldsJson = category && b.category_fields ? JSON.stringify(b.category_fields) : null;
  const itemId = b.item_id ? Number(b.item_id) : null;
  const requiresManufacturing = b.requires_manufacturing === false ? 0 : 1;

  const res = await execute(
    `INSERT INTO bom_items
       (project_id, material_description, moc, size_spec, qty_text, purchase_status, source,
        category, category_fields_json, item_id, requires_manufacturing, pending_review)
     VALUES (?, ?, ?, ?, ?, 'Enquiry', 'custom', ?, ?, ?, ?, 0)`,
    [projectId, b.material_description.trim(), b.moc || null, b.size_spec || null, b.qty_text || null,
      category, categoryFieldsJson, itemId, requiresManufacturing]
  );

  await audit('bom_item_add', {
    actor: user.username,
    detail: JSON.stringify({
      bom_item_id: Number(res.lastId), project_id: projectId,
      description: b.material_description.trim(), source: 'custom',
    }),
  });
  if (category) {
    try { await learnCategoryIfConfirmed(b.material_description.trim(), category, user.username); } catch { /* best-effort */ }
  }

  return NextResponse.json({ id: Number(res.lastId) });
}
