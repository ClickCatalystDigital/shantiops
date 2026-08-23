// Closes a dispositioned NCR. The real enforcement: if rework produced a job card, that card must
// actually be 'done' on the shop floor before the paper trail can close — an NCR can't be closed
// while its rework is still open.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, 'QC', 'qc.ncr.close');
  if (actionDenied) return actionDenied;

  const ncr = await queryOne('SELECT * FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ncr.status !== 'dispositioned') return NextResponse.json({ error: 'Only a dispositioned NCR can be closed' }, { status: 400 });

  if (ncr.rework_job_card_id) {
    const card = await queryOne('SELECT status FROM job_cards WHERE id = ?', [ncr.rework_job_card_id]);
    if (!card || card.status !== 'done') {
      return NextResponse.json({ error: 'Rework job card is not finished yet' }, { status: 400 });
    }
  }

  await execute(
    "UPDATE ncr_records SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?",
    [user.username, params.id]
  );
  await audit('ncr_closed', { actor: user.username, detail: ncr.ncr_no });
  return NextResponse.json({ ok: true });
}
