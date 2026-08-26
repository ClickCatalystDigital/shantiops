// app/api/purchase-requisitions/route.js — Group 5 Bundle A (unified PR flow, D3). Eng/Design/
// Stores raise a PR (one or more lines, each split across one or more projects with its own qty) and
// it materializes straight to bom_items — no acceptance gate (client decision: replaces the old
// single-item procurement_requests flow, which is now dead but left in place, same "don't drop"
// precedent as the retired tickets table).
//
// V2-CHANGES.md Group 6 Phase 6.4 (D7) — a line's `source` (bom/stock/sas), server-enforced not
// just hidden client-side. 'stock' is Stores-only (needs an inventory item, Stores' own picker).
// 'sas' materializes a single bom_items row pointed at the sentinel system project
// (bom_items.project_id stays NOT NULL, see Phase 6.4's plan note) instead of a real project — no
// pr_item_projects split, since there's no project to split across.
//
// STORES-SALES-CHANGES.md — SAS used to be Stores-initiated (Stores raising a trade line against a
// Sale Order themselves), then briefly both Stores-and-Sales; it's now Sales-only by client
// decision — Sales pushes the request, Stores only ever receives and fulfills it.
import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { getAllocationMode, autoReserveFromStock, notifyProcurementIfShortfall } from '@/lib/procurement';
import { matchAndReserve } from '@/lib/remnant-match';
import { DIMENSIONAL_CATEGORIES } from '@/lib/bom-fields.mjs';

const PR_DEPARTMENTS = ['Engineering', 'Design', 'Stores', 'Sales'];
const SAS_RAISERS = new Set(['Sales']);
// CALC-CHANGES2.md §F — category tag, 'bom'-source lines only (stock/sas are inventory/trade
// lines, not physical-material categories). DIMENSIONAL_CATEGORIES is the shared, single source of
// truth (lib/remnant-match.js) for every shape the composer can tag a line with; 'standard' is the
// one non-dimensional category (an item-master reference + qty, no geometry to match on).
const CATEGORIES = new Set([...DIMENSIONAL_CATEGORIES, 'standard']);

export async function POST(req) {
  const user = await getFreshSessionUser();
  const b = await req.json();

  const raisedByDept = b.raised_by_dept;
  if (!PR_DEPARTMENTS.includes(raisedByDept) || !canAccessDepartment(user, raisedByDept)) {
    return NextResponse.json({ error: 'Pick a department you belong to' }, { status: 403 });
  }

  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return NextResponse.json({ error: 'Add at least one line' }, { status: 400 });
  for (const line of lines) {
    if (!String(line.material_description || '').trim()) {
      return NextResponse.json({ error: 'Every line needs a description' }, { status: 400 });
    }
    const source = line.source || 'bom';
    if (raisedByDept === 'Sales' && source !== 'sas') {
      return NextResponse.json({ error: 'Sales can only raise trade (SAS) requests' }, { status: 403 });
    }
    if (source === 'stock' && raisedByDept !== 'Stores') {
      return NextResponse.json({ error: 'Only Stores can raise stock requests' }, { status: 403 });
    }
    if (source === 'sas' && !SAS_RAISERS.has(raisedByDept)) {
      return NextResponse.json({ error: 'Only Sales can raise trade (SAS) requests' }, { status: 403 });
    }
    if (source === 'stock') {
      if (!line.inventory_item_id || !(Number(line.qty) > 0)) {
        return NextResponse.json({ error: `"${line.material_description}" needs an inventory item and a quantity` }, { status: 400 });
      }
    } else if (source === 'sas') {
      if (!String(line.sale_order_no || '').trim() || !String(line.qty_text || '').trim()) {
        return NextResponse.json({ error: `"${line.material_description}" needs a Sale Order and a quantity` }, { status: 400 });
      }
    } else {
      const projects = Array.isArray(line.projects) ? line.projects : [];
      if (!projects.length || projects.some(p => !p.project_id || !String(p.qty_text || '').trim())) {
        return NextResponse.json({ error: `"${line.material_description}" needs at least one project + qty` }, { status: 400 });
      }
    }
  }

  const seq = await nextCounterValue('pr_no', 0);
  const prNo = `PR-${seq}`;
  const { lastId: prId } = await execute(
    'INSERT INTO purchase_requisitions (pr_no, raised_by_dept, created_by) VALUES (?, ?, ?)',
    [prNo, raisedByDept, user.username]
  );

  // Allocation Mode gate, refined 2026-08-20 — 'bom'/'sas' lines used to always gate behind
  // pending_review=1 (Stores review of every line, regardless of what's actually in stock). Auto
  // mode instead inserts open (0) and immediately tries the same auto-match reuse/matchAndReserve
  // already does for the release-bom/single-add paths — SAS demand goes through the identical
  // allocation mechanism as project BOM demand, per the redesign (Sales still owns raising it, this
  // is only about how it gets fulfilled). 'stock' is unaffected — Stores' own Build-stock request
  // already skipped this gate entirely before this change.
  const allocationMode = await getAllocationMode();
  const gatedPendingReview = allocationMode === 'manual' ? 1 : 0;

  const bomItemIds = [];
  for (const [i, line] of lines.entries()) {
    const source = line.source || 'bom';
    // Category is a 'bom'-source-only concept (a physical material shape); stock/sas lines never
    // carry one. origin defaults to 'manual' — 'bom' is reserved for a future auto-BOM generator,
    // not produced by anything this round.
    const category = source === 'bom' && CATEGORIES.has(line.category) ? line.category : null;
    const categoryFieldsJson = category && line.category_fields ? JSON.stringify(line.category_fields) : null;
    // Design's optional named-part breakdown (one purchased line -> several separately-named
    // fabricated parts) — see components/PrWorkspace.jsx's NamedPartsEditor. Same shape as
    // category_fields_json: carried on every INSERT below, consumed later by
    // lib/qc-bom-sync.js's syncQcPartsFromBom.
    const namedPartsJson = category && line.named_parts?.length ? JSON.stringify(line.named_parts) : null;
    const origin = line.origin === 'bom' ? 'bom' : 'manual';
    // pr_items has no separate uom column — like bom_items.qty_text everywhere else in this app,
    // quantity and unit are one free-text field ("4 Nos"), typed per-project below since that's
    // where the real quantity actually lives (a PR line's qty is the sum of its project splits,
    // never entered as one number up front).
    const { lastId: prItemId } = await execute(
      `INSERT INTO pr_items (pr_id, material_description, moc, size_spec, sort_order, category, category_fields_json, named_parts_json, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(prId), line.material_description.trim(), line.moc || null, line.size_spec || null, i, category, categoryFieldsJson, namedPartsJson, origin]
    );

    // §3.2 — only ever set when the line was actually picked from the catalog search
    // (PrWorkspace's ItemSearchField); a hand-typed description clears it client-side.
    const itemId = line.item_id ? Number(line.item_id) : null;
    // Traceability requirement flags (Phase 1) — the composer seeds these from the picked item's
    // default_requires_* or a category fallback (ItemSearchField/CategoryFieldsBlock), but Engineering
    // can override per line before submit; whatever the line carries at raise time is the effective
    // value from here on (BOM_FIELD_OWNERS governs edits after creation, not this initial insert).
    const requiresHeatNo = line.requires_heat_no ? 1 : 0;
    const requiresMtc = line.requires_mtc ? 1 : 0;
    const requiresSupplierBatch = line.requires_supplier_batch ? 1 : 0;
    const requiresSerialNo = line.requires_serial_no ? 1 : 0;

    if (source === 'stock') {
      // Stores raising a Build stock request is already Stores' own decision — no second
      // self-review gate needed, unlike 'bom'/'sas' below.
      const sentinel = await queryOne('SELECT id FROM projects WHERE is_system = 1 LIMIT 1');
      const { lastId: bomItemId } = await execute(
        `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, purchase_status,
                                 pr_item_id, source, inventory_item_id, inventory_qty, category, category_fields_json, named_parts_json, origin, item_id,
                                 requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no)
         VALUES (?, ?, ?, ?, ?, 'Enquiry', ?, 'stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sentinel.id, line.material_description.trim(), line.moc || null, line.size_spec || null,
          String(line.qty), Number(prItemId), Number(line.inventory_item_id), Number(line.qty), category, categoryFieldsJson, namedPartsJson, origin, itemId,
          requiresHeatNo, requiresMtc, requiresSupplierBatch, requiresSerialNo]
      );
      bomItemIds.push(Number(bomItemId));
    } else if (source === 'sas') {
      const sentinel = await queryOne('SELECT id FROM projects WHERE is_system = 1 LIMIT 1');
      const { lastId: bomItemId } = await execute(
        `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, purchase_status,
                                 pr_item_id, source, sale_order_no, category, category_fields_json, named_parts_json, origin, pending_review, item_id,
                                 requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no)
         VALUES (?, ?, ?, ?, ?, 'Enquiry', ?, 'sas', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sentinel.id, line.material_description.trim(), line.moc || null, line.size_spec || null,
          line.qty_text.trim(), Number(prItemId), line.sale_order_no.trim(), category, categoryFieldsJson, namedPartsJson, origin, gatedPendingReview, itemId,
          requiresHeatNo, requiresMtc, requiresSupplierBatch, requiresSerialNo]
      );
      bomItemIds.push(Number(bomItemId));
      if (allocationMode === 'auto') {
        const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [Number(bomItemId)]);
        const dimResult = await matchAndReserve(item, user.username);
        if (dimResult.matched === 0) await autoReserveFromStock(item, user.username);
        await notifyProcurementIfShortfall(Number(bomItemId));
      }
    } else {
      for (const p of line.projects) {
        await execute(
          'INSERT INTO pr_item_projects (pr_item_id, project_id, qty_text) VALUES (?, ?, ?)',
          [Number(prItemId), p.project_id, p.qty_text.trim()]
        );
        // Materializes immediately — this line×project pair is the real procurement need. Manual
        // mode keeps it out of Procurement's Enquiry queue until Stores explicitly reserves it or
        // clicks Procure; Auto mode tries the same allocation the release-bom/single-add paths use,
        // right here (the unify decision was "no accept step", this doesn't reintroduce one).
        const { lastId: bomItemId } = await execute(
          `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, purchase_status, pr_item_id, category, category_fields_json, named_parts_json, origin, pending_review, item_id, drawing_id,
                                   requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no)
           VALUES (?, ?, ?, ?, ?, 'Enquiry', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.project_id, line.material_description.trim(), line.moc || null, line.size_spec || null,
            p.qty_text.trim(), Number(prItemId), category, categoryFieldsJson, namedPartsJson, origin, gatedPendingReview, itemId,
            p.drawing_id ? Number(p.drawing_id) : null,
            requiresHeatNo, requiresMtc, requiresSupplierBatch, requiresSerialNo]
        );
        bomItemIds.push(Number(bomItemId));
        if (allocationMode === 'auto') {
          const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [Number(bomItemId)]);
          const dimResult = await matchAndReserve(item, user.username);
          if (dimResult.matched === 0) await autoReserveFromStock(item, user.username);
          await notifyProcurementIfShortfall(Number(bomItemId));
        }
      }
    }
  }

  await audit('pr_raised', {
    actor: user.username,
    detail: `${prNo} (${raisedByDept}): ${lines.length} line(s), ${bomItemIds.length} item(s)`,
  });
  // STORES-SALES-CHANGES.md §3.1/§4 — every line here lands on Stores' workbench one way or
  // another (Enquiry queue or their own Requests tab); tell them, don't make them go look.
  if (raisedByDept !== 'Stores') {
    try {
      await notifyDepartment('Stores', {
        kind: 'bom_released', title: `New ${prNo} from ${raisedByDept}`,
        body: `${lines.length} line(s)`, dedupe_key: `pr_raised:${prNo}`,
      });
    } catch (err) { /* notification is best-effort */ }
  }
  return NextResponse.json({ pr_no: prNo, bom_item_ids: bomItemIds });
}
