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
