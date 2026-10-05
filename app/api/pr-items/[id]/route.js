// app/api/pr-items/[id]/route.js — edit a PR item after it was raised (PR History's pencil). The
// whole item is editable: description / MOC / dimensions on the PR line, and its project splits
// (change a project or clear it, change qty or dimensions, add or remove a split). Gated to the
// raising department's Head (or a PM) — a deliberate trust decision, not a technical guard.
//
// Each split is one bom_items row (pr_item_id -> this item). A split with no project sits on the
// sentinel system project as source='custom' (same as the raise route and Procurement's own
// custom-item add); giving it a project turns it back into a normal 'bom' row.
//
// What is still refused, because it would corrupt real records rather than just edit them:
//   - removing a split that already has downstream records (quote, PO, receipt, reservation ...),
//     same schema-derived list the single-item DELETE uses (lib/bom-item-guard.js);
//   - moving a split to another project once stock was received / reserved / allocated for it
//     (only procurement-stage records — quotes, RFQs, PO lines — are project-agnostic and may move);
//   - Build-stock and trade (SAS) lines, which have no project split to edit.
// Edits do NOT rewrite a purchase order's snapshot (po_items description/qty), only its project.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { CATEGORY_LABEL } from '@/lib/section-shapes';
import { findBlockingReferences } from '@/lib/bom-item-guard';
import { getAllocationMode, autoReserveFromStock, notifyProcurementIfShortfall } from '@/lib/procurement';
import { matchAndReserve } from '@/lib/remnant-match';

const CATEGORIES = new Set(Object.keys(CATEGORY_LABEL));
// Records that don't depend on which project the line belongs to.
const PROJECT_AGNOSTIC = new Set(['po_items', 'supplier_quotes', 'rfq_items', 'delivery_followups']);
const CLOSED = new Set(['Received', 'In-Stock', 'Cancelled']);
const json = v => (v ? JSON.stringify(v) : null);

export async function PUT(req, { params }) {
  const user = await getFreshSessionUser();
  const prItem = await queryOne(
    `SELECT pi.*, pr.raised_by_dept, pr.pr_no FROM pr_items pi JOIN purchase_requisitions pr ON pr.id = pi.pr_id WHERE pi.id = ?`,
    [params.id]);
  if (!prItem) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!user || !isDepartmentHead(user, prItem.raised_by_dept)) {
    return NextResponse.json({ error: `Only the ${prItem.raised_by_dept} Head can edit this PR` }, { status: 403 });
  }

  const b = await req.json();
  const description = String(b.material_description || '').trim();
  if (!description) return NextResponse.json({ error: 'A description is required' }, { status: 400 });
  if (b.category && !CATEGORIES.has(b.category)) return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  const category = b.category || null;
  const rows = Array.isArray(b.projects) ? b.projects : [];
  if (!rows.length || rows.some(r => !String(r.qty_text || '').trim())) {
    return NextResponse.json({ error: 'Every split needs a quantity' }, { status: 400 });
  }

  const existing = await queryAll('SELECT * FROM bom_items WHERE pr_item_id = ?', [prItem.id]);
  if (existing.some(e => e.source === 'stock' || e.source === 'sas')) {
    return NextResponse.json({ error: 'Build-stock and trade lines can not be edited here' }, { status: 400 });
  }
  const byId = new Map(existing.map(e => [e.id, e]));
  if (rows.some(r => r.bom_item_id && !byId.has(Number(r.bom_item_id)))) {
    return NextResponse.json({ error: 'A split does not belong to this PR item' }, { status: 400 });
  }
  const sentinel = await queryOne('SELECT id FROM projects WHERE is_system = 1 LIMIT 1');
  for (const r of rows) {
    if (r.project_id && !(await queryOne('SELECT id FROM projects WHERE id = ? AND is_system = 0', [Number(r.project_id)]))) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
  }

  // Pre-checks, before any write.
  const keptIds = new Set(rows.filter(r => r.bom_item_id).map(r => Number(r.bom_item_id)));
  for (const e of existing) {
    const { reasons } = await findBlockingReferences(e.id);
    if (!keptIds.has(e.id) && reasons.length) {
      return NextResponse.json({ error: `A removed split ${reasons[0].label} — it can't be deleted (history is kept)` }, { status: 409 });
    }
    const row = rows.find(r => Number(r.bom_item_id) === e.id);
    if (row && Number(row.project_id || sentinel.id) !== e.project_id) {
      if (CLOSED.has(e.purchase_status) || reasons.some(r => !PROJECT_AGNOSTIC.has(r.table))) {
        return NextResponse.json({ error: `A split already ${CLOSED.has(e.purchase_status) ? 'closed (' + e.purchase_status + ')' : (reasons.find(r => !PROJECT_AGNOSTIC.has(r.table)).label)} — its project can't be changed` }, { status: 409 });
      }
    }
  }

  const categoryFieldsJson = category && b.category_fields ? json(b.category_fields) : null;
  const namedPartsJson = category && b.named_parts?.length ? json(b.named_parts) : null;
  const itemId = b.item_id ? Number(b.item_id) : null;
  const flags = [b.requires_heat_no, b.requires_mtc, b.requires_supplier_batch, b.requires_serial_no].map(v => (v ? 1 : 0));
  const requiresManufacturing = b.requires_manufacturing === false ? 0 : 1;

  const newIds = [];
  await withTransaction(async tx => {
    await tx.execute({
      sql: `UPDATE pr_items SET material_description = ?, moc = ?, size_spec = ?, category = ?, category_fields_json = ?, named_parts_json = ? WHERE id = ?`,
      args: [description, b.moc || null, b.size_spec || null, category, categoryFieldsJson, namedPartsJson, prItem.id] });

    for (const e of existing) {
      if (keptIds.has(e.id)) continue;
      await tx.execute({ sql: 'DELETE FROM bom_items WHERE id = ?', args: [e.id] });
    }
    await tx.execute({ sql: 'DELETE FROM pr_item_projects WHERE pr_item_id = ?', args: [prItem.id] });

    for (const r of rows) {
      const projectId = r.project_id ? Number(r.project_id) : null;
      if (projectId) {
        await tx.execute({ sql: 'INSERT INTO pr_item_projects (pr_item_id, project_id, qty_text) VALUES (?, ?, ?)',
          args: [prItem.id, projectId, String(r.qty_text).trim()] });
      }
      const rowCategoryFields = category && r.category_fields ? json(r.category_fields) : categoryFieldsJson;
      const rowSizeSpec = r.size_spec || b.size_spec || null;
      const common = [description, b.moc || null, rowSizeSpec, String(r.qty_text).trim(), category, rowCategoryFields, namedPartsJson,
        itemId, r.drawing_id && projectId ? Number(r.drawing_id) : null, ...flags, requiresManufacturing];
      const cur = r.bom_item_id ? byId.get(Number(r.bom_item_id)) : null;
      if (cur) {
        const newProject = projectId || sentinel.id;
        const moved = newProject !== cur.project_id;
        await tx.execute({
          sql: `UPDATE bom_items SET material_description = ?, moc = ?, size_spec = ?, qty_text = ?, category = ?, category_fields_json = ?,
                  named_parts_json = ?, item_id = ?, drawing_id = ?, requires_heat_no = ?, requires_mtc = ?, requires_supplier_batch = ?,
                  requires_serial_no = ?, requires_manufacturing = ?, project_id = ?, source = ?
                  ${moved ? ', assembly_id = NULL' : ''} WHERE id = ?`,
          args: [...common, newProject, projectId ? 'bom' : 'custom', cur.id] });
        if (moved) await tx.execute({ sql: 'UPDATE po_items SET project_id = ? WHERE bom_item_id = ?', args: [newProject, cur.id] });
      } else {
        const ins = await tx.execute({
          sql: `INSERT INTO bom_items (material_description, moc, size_spec, qty_text, category, category_fields_json, named_parts_json, item_id, drawing_id,
                  requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no, requires_manufacturing,
                  project_id, source, purchase_status, pr_item_id, origin, pending_review)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Enquiry', ?, 'manual', 0)`,
          args: [...common, projectId || sentinel.id, projectId ? 'bom' : 'custom', prItem.id] });
        newIds.push(Number(ins.lastInsertRowid));
      }
    }
  });

  // Same auto stock matching the raise route does, for splits added here (best-effort).
  try {
    if (newIds.length && (await getAllocationMode()) === 'auto') {
      for (const id of newIds) {
        const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [id]);
        const dim = await matchAndReserve(item, user.username);
        if (dim.matched === 0) await autoReserveFromStock(item, user.username);
        await notifyProcurementIfShortfall(id);
      }
    }
  } catch { /* matching is best-effort; the edit itself already succeeded */ }

  await audit('pr_item_edit', { actor: user.username, detail: `${prItem.pr_no} item ${prItem.id}: ${description}, ${rows.length} split(s)` });
  return NextResponse.json({ ok: true });
}
