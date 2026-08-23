// Releases a QC hold point on a job card (plan §5d) — QC-only, Production cannot self-release.
// Refuses while any linked NCR is still open, the real NCR↔hold link.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, 'QC', 'qc.hold.release');
  if (actionDenied) return actionDenied;

  const card = await queryOne(
    'SELECT id, project_id, requires_qc_hold, qc_released_at FROM job_cards WHERE id = ?', [params.id]);
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!card.requires_qc_hold) return NextResponse.json({ error: 'This card has no QC hold point' }, { status: 400 });
  if (card.qc_released_at) return NextResponse.json({ error: 'Already released' }, { status: 400 });

  const openNcr = await queryOne(
    "SELECT id FROM ncr_records WHERE job_card_id = ? AND status != 'closed' LIMIT 1", [params.id]);
  if (openNcr) return NextResponse.json({ error: 'An NCR against this card is still open' }, { status: 400 });

  await execute(
    'UPDATE job_cards SET qc_released_at = CURRENT_TIMESTAMP, qc_released_by = ? WHERE id = ?',
    [user.username, params.id]
  );
  await audit('qc_hold_released', { actor: user.username, detail: `Job card #${params.id}` });
  try {
    await notifyDepartment('Production', {
      kind: 'qc_hold_released', title: `QC released job card #${params.id}`,
      project_id: card.project_id, dedupe_key: `qc_hold_released:${params.id}`,
    });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ ok: true });
}
