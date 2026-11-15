import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { queryOne, withTransaction } from '@/lib/db';
import { audit } from '@/lib/usb';

// Sheets are independently deletable; projects are intentionally not deleted here.
export async function DELETE(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  const sheet = await queryOne('SELECT id, project_id, name FROM calc_sheets WHERE id = ?', [params.id]);
  if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
  // Any sheet can go, including a project's last one. Drawing/BOM links to it go with it; drawings stay.
  await withTransaction(async (tx) => {
    for (const sql of [
      'DELETE FROM calc_sheet_drawings WHERE calc_sheet_id = ?',
      'DELETE FROM bom_assembly_calc_sheets WHERE calc_sheet_id = ?',
      'DELETE FROM calc_variables WHERE calc_sheet_id = ?',
      'DELETE FROM calc_snapshots WHERE calc_sheet_id = ?',
      "DELETE FROM calc_notes WHERE calc_sheet_id = ? AND entity_type = 'variable'",
      'DELETE FROM calc_sheets WHERE id = ?',
    ]) await tx.execute({ sql, args: [sheet.id] });
  });
  await audit('calc_sheet_deleted', { actor: user.username, detail: `${sheet.name} (project ${sheet.project_id})` });
  return NextResponse.json({ ok: true });
}
