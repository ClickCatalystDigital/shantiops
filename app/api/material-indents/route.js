// app/api/material-indents/route.js — Material Indent (Feature B). Production raises an indent
// before drawing material from Stores; Stores explicitly releases/reserves against it
// (see [id]/items/[itemId]/release and reserve-piece). No path here lets Production self-serve the
// actual material_issues insert or a piece cut — those still only happen via Stores' own action.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextNumber, withTransaction } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { notifyDepartment } from '@/lib/notify';
import { getInventoryItemForBomItem } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const status = params.get('status');
  const projectId = params.get('project_id');
  const where = [];
  const args = [];
  if (status) { where.push('mi.status = ?'); args.push(status); }
  if (projectId) { where.push('mi.project_id = ?'); args.push(Number(projectId)); }
  const indents = await queryAll(
    `SELECT mi.*, p.project_no FROM material_indents mi
       LEFT JOIN projects p ON p.id = mi.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY mi.id DESC`, args);
  if (!indents.length) return NextResponse.json([]);
  const items = await queryAll(
    `SELECT mii.*, b.material_description AS bom_description, i.description AS inventory_description,
            i.tracking_mode AS tracking_mode
       FROM material_indent_items mii
       LEFT JOIN bom_items b ON b.id = mii.bom_item_id
       LEFT JOIN inventory_items i ON i.id = mii.inventory_item_id
      WHERE mii.indent_id IN (${indents.map(() => '?').join(',')})`,
    indents.map(i => i.id));
  return NextResponse.json(indents.map(i => ({ ...i, items: items.filter(it => it.indent_id === i.id) })));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireAction(user, 'Production', 'production.indent.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const lines = Array.isArray(b.items) ? b.items : [];
  if (!lines.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });

  for (const line of lines) {
    if (!(Number(line.qty_requested) > 0)) return NextResponse.json({ error: 'Enter a quantity for each item' }, { status: 400 });
    if (!line.bom_item_id && !line.inventory_item_id) {
      return NextResponse.json({ error: 'Each item needs either a BOM line or an inventory line' }, { status: 400 });
    }
    if (line.inventory_item_id) {
      const invItem = await queryOne('SELECT tracking_mode FROM inventory_items WHERE id = ?', [line.inventory_item_id]);
      if (!invItem) return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      // material_issues.bom_item_id is NOT NULL — scalar/batch/serial lines must trace to a real BOM
      // requirement (this is why a bom_item_id-less line is only ever valid for piece-tracked
      // material, whose consumption path is reserve-piece + Cut, never a material_issues insert).
      if (invItem.tracking_mode !== 'piece' && !line.bom_item_id) {
        return NextResponse.json({ error: 'A BOM item is required for non piece-tracked lines' }, { status: 400 });
      }
    }
    if (line.bom_item_id) {
      const bomItem = await queryOne('SELECT id FROM bom_items WHERE id = ?', [line.bom_item_id]);
      if (!bomItem) return NextResponse.json({ error: 'BOM item not found' }, { status: 404 });
    }
  }

  // inventory_item_id is a display/lookup hint only — the actual release resolves the real
  // inventory line itself (via getInventoryItemForBomItem, same as issueMaterial()); a BOM line with
  // no catalog link at all correctly ends up with this as null, matching how a plain, uncosted
  // material_issues row already works today. Resolved before opening the transaction below (a plain
  // read has no reason to share the transaction's connection).
  const resolvedInventoryIds = await Promise.all(lines.map(async line => {
    if (line.inventory_item_id) return Number(line.inventory_item_id);
    if (line.bom_item_id) return (await getInventoryItemForBomItem(Number(line.bom_item_id)))?.id || null;
    return null;
  }));

  const indentNo = await nextNumber('indent_no', 'IND');
  const indentId = await withTransaction(async tx => {
    const ins = await tx.execute({
      sql: `INSERT INTO material_indents (indent_no, project_id, job_card_id, requested_by, notes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [indentNo, b.project_id ? Number(b.project_id) : null, b.job_card_id ? Number(b.job_card_id) : null,
        user.username, b.notes ? String(b.notes).trim() : null],
    });
    const id = Number(ins.lastInsertRowid);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await tx.execute({
        sql: `INSERT INTO material_indent_items (indent_id, inventory_item_id, bom_item_id, qty_requested)
              VALUES (?, ?, ?, ?)`,
        args: [id, resolvedInventoryIds[i], line.bom_item_id ? Number(line.bom_item_id) : null, Number(line.qty_requested)],
      });
    }
    return id;
  });

  await audit('indent_raised', { actor: user.username, detail: `${indentNo} · ${lines.length} item(s)` });
  await notifyDepartment('Stores', {
    kind: 'indent_raised', title: `Material Indent ${indentNo}`,
    body: `Raised by ${user.username}`, project_id: b.project_id ? Number(b.project_id) : null,
  }, { actionKey: 'stores.indent.release' });

  return NextResponse.json({ id: indentId, indent_no: indentNo });
}
