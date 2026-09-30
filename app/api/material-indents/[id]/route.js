// app/api/material-indents/[id]/route.js — one indent + cancellation. Cancelling never touches an
// already-'released' item (see lib/indent-status.mjs's rollup rules) — material already handed over
// is a completed fact, not something a later cancellation can undo.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { getMaterialIndentDetail } from '@/lib/data';
import { releasePiece } from '@/lib/stock-pieces';
import { rollupIndentStatus } from '@/lib/indent-status.mjs';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getMaterialIndentDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...detail.indent, items: detail.items });
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

// Delete an indent outright — only while nothing has been handed over against it (no quantity
// released, no piece reserved, no issue recorded). Otherwise it stays as a record and can be cancelled.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'Stores')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const used = await queryAll(
    `SELECT (SELECT COUNT(*) FROM material_indent_items WHERE indent_id = ? AND qty_released > 0)
          + (SELECT COUNT(*) FROM stock_pieces WHERE indent_item_id IN (SELECT id FROM material_indent_items WHERE indent_id = ?))
          + (SELECT COUNT(*) FROM material_issues WHERE indent_item_id IN (SELECT id FROM material_indent_items WHERE indent_id = ?)) AS n`,
    [params.id, params.id, params.id]);
  if (Number(used[0]?.n) > 0) {
    return NextResponse.json({ error: 'Material has already been handed over against this indent — cancel it instead of deleting.' }, { status: 409 });
  }
  await execute('DELETE FROM material_indent_items WHERE indent_id = ?', [params.id]);
  await execute('DELETE FROM material_indents WHERE id = ?', [params.id]);
  await audit('material_indent_deleted', { actor: user.username, detail: `indent ${params.id}` });
  return NextResponse.json({ ok: true });
}
