import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { queryOne, execute } from '@/lib/db';
import { audit } from '@/lib/usb';

// Sheets are independently deletable; projects are intentionally not deleted here.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  const sheet = await queryOne('SELECT id, project_id, name FROM calc_sheets WHERE id = ?', [params.id]);
  if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
  const count = await queryOne('SELECT COUNT(*) AS count FROM calc_sheets WHERE project_id = ?', [sheet.project_id]);
  if (Number(count?.count || 0) <= 1) return NextResponse.json({ error: 'A project must keep at least one calculation sheet' }, { status: 400 });

  await execute('DELETE FROM calc_variables WHERE calc_sheet_id = ?', [params.id]);
  await execute('DELETE FROM calc_snapshots WHERE calc_sheet_id = ?', [params.id]);
  await execute("DELETE FROM calc_notes WHERE calc_sheet_id = ? AND entity_type = 'variable'", [params.id]);
  await execute('DELETE FROM calc_sheets WHERE id = ?', [params.id]);
  await audit('calc_sheet_deleted', { actor: user.username, detail: `${sheet.name} (project ${sheet.project_id})` });
  return NextResponse.json({ ok: true });
}
