import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { audit } from '@/lib/usb';

// BOM workspace round 2 — a calc sheet substantiates a DRAWING, not a bom_assemblies tree node
// (see lib/db.js's calc_sheet_drawings comment). Same junction-CRUD shape as
// app/api/bom-assemblies/[id]/calc-sheets/route.js, keyed by drawing_id instead of assembly_id, and
// gated requireCalcAccess (Design OR Engineering — Calc is jointly owned) rather than
// requireDepartment('Engineering').
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  const rows = await queryAll(
    `SELECT cd.id AS link_id, cd.linked_at, s.id, s.cs_no, s.name
       FROM calc_sheet_drawings cd JOIN calc_sheets s ON s.id = cd.calc_sheet_id
      WHERE cd.drawing_id = ? ORDER BY cd.linked_at DESC`, [params.id]);
  return NextResponse.json(rows);
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  if (!b.calc_sheet_id) return NextResponse.json({ error: 'calc_sheet_id is required' }, { status: 400 });

  const drawing = await queryOne('SELECT id, project_id, name FROM calc_drawings WHERE id = ?', [params.id]);
  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sheet = await queryOne('SELECT id, project_id, name FROM calc_sheets WHERE id = ?', [b.calc_sheet_id]);
  if (!sheet || sheet.project_id !== drawing.project_id) {
    return NextResponse.json({ error: 'Calc sheet not found on this project' }, { status: 400 });
  }

  const existing = await queryOne(
    'SELECT id FROM calc_sheet_drawings WHERE calc_sheet_id = ? AND drawing_id = ?', [b.calc_sheet_id, params.id]);
  if (!existing) {
    await execute(
      'INSERT INTO calc_sheet_drawings (calc_sheet_id, drawing_id, linked_by) VALUES (?, ?, ?)',
      [b.calc_sheet_id, params.id, user.username]
    );
    await audit('calc_sheet_drawing_link', { actor: user.username, detail: `${sheet.name} -> ${drawing.name}` });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const calcSheetId = new URL(req.url).searchParams.get('calc_sheet_id');
  if (!calcSheetId) return NextResponse.json({ error: 'calc_sheet_id is required' }, { status: 400 });

  await execute('DELETE FROM calc_sheet_drawings WHERE calc_sheet_id = ? AND drawing_id = ?', [calcSheetId, params.id]);
  await audit('calc_sheet_drawing_unlink', { actor: user.username, detail: `drawing ${params.id} <- calc sheet ${calcSheetId}` });
  return NextResponse.json({ ok: true });
}
