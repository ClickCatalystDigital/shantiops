// app/api/material-indents/[id]/route.js — one indent + cancellation. Cancelling never touches an
// already-'released' item (see lib/indent-status.mjs's rollup rules) — material already handed over
// is a completed fact, not something a later cancellation can undo.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { releasePiece } from '@/lib/stock-pieces';
import { rollupIndentStatus } from '@/lib/indent-status.mjs';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const indent = await queryOne(
    `SELECT mi.*, p.project_no FROM material_indents mi LEFT JOIN projects p ON p.id = mi.project_id WHERE mi.id = ?`,
    [params.id]);
  if (!indent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const items = await queryAll(
    `SELECT mii.*, b.material_description AS bom_description, i.description AS inventory_description,
            i.tracking_mode AS tracking_mode
       FROM material_indent_items mii
       LEFT JOIN bom_items b ON b.id = mii.bom_item_id
       LEFT JOIN inventory_items i ON i.id = mii.inventory_item_id
      WHERE mii.indent_id = ?`, [params.id]);
  return NextResponse.json({ ...indent, items });
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const b = await req.json();
  if (b.status !== 'cancelled') return NextResponse.json({ error: 'Only cancellation is supported here' }, { status: 400 });
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'Stores')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const items = await queryAll(
    "SELECT * FROM material_indent_items WHERE indent_id = ? AND status != 'released'", [params.id]);
  for (const item of items) {
    if (item.stock_piece_id) await releasePiece(item.stock_piece_id);
    await execute("UPDATE material_indent_items SET status = 'cancelled' WHERE id = ?", [item.id]);
  }

  const allStatuses = (await queryAll(
    'SELECT status FROM material_indent_items WHERE indent_id = ?', [params.id])).map(r => r.status);
  await execute('UPDATE material_indents SET status = ? WHERE id = ?', [rollupIndentStatus(allStatuses), params.id]);

  await audit('indent_cancelled', { actor: user.username, detail: `indent #${params.id}` });
  return NextResponse.json({ ok: true });
}
