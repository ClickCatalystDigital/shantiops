import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// BOM workspace Phase 2 — junction CRUD for bom_assembly_calc_sheets, same shape as the sibling
// drawings route (see its own comment for the reasoning behind the auth choices).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await queryAll(
    `SELECT ac.id AS link_id, ac.linked_at, s.id, s.cs_no, s.name
       FROM bom_assembly_calc_sheets ac JOIN calc_sheets s ON s.id = ac.calc_sheet_id
      WHERE ac.assembly_id = ? ORDER BY ac.linked_at DESC`, [params.id]);
  return NextResponse.json(rows);
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.calc_sheet_id) return NextResponse.json({ error: 'calc_sheet_id is required' }, { status: 400 });

  const assembly = await queryOne('SELECT id, project_id, name FROM bom_assemblies WHERE id = ?', [params.id]);
  if (!assembly) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sheet = await queryOne('SELECT id, project_id, name FROM calc_sheets WHERE id = ?', [b.calc_sheet_id]);
  if (!sheet || sheet.project_id !== assembly.project_id) {
    return NextResponse.json({ error: 'Calc sheet not found on this project' }, { status: 400 });
  }

  const existing = await queryOne(
    'SELECT id FROM bom_assembly_calc_sheets WHERE assembly_id = ? AND calc_sheet_id = ?', [params.id, b.calc_sheet_id]);
  if (!existing) {
    await execute(
      'INSERT INTO bom_assembly_calc_sheets (assembly_id, calc_sheet_id, linked_by) VALUES (?, ?, ?)',
      [params.id, b.calc_sheet_id, user.username]
    );
    await audit('bom_assembly_calc_link', { actor: user.username, detail: `${assembly.name} <- ${sheet.name}` });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (actionDenied) return actionDenied;

  const calcSheetId = new URL(req.url).searchParams.get('calc_sheet_id');
  if (!calcSheetId) return NextResponse.json({ error: 'calc_sheet_id is required' }, { status: 400 });

  await execute('DELETE FROM bom_assembly_calc_sheets WHERE assembly_id = ? AND calc_sheet_id = ?', [params.id, calcSheetId]);
  await audit('bom_assembly_calc_unlink', { actor: user.username, detail: `assembly ${params.id} <- calc sheet ${calcSheetId}` });
  return NextResponse.json({ ok: true });
}
