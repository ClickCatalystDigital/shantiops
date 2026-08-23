// QC verification (2026-08-23 hardening pass) — a distinct fact from Close. "Production finished
// the rework" and "QC actually re-inspected it" are two different things; this records the second
// one explicitly, as its own QC action, rather than folding it into the Close click. Close now
// requires qc_verified_at to already be set.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, 'QC', 'qc.ncr.verify');
  if (actionDenied) return actionDenied;

  const ncr = await queryOne('SELECT * FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ncr.status !== 'dispositioned') return NextResponse.json({ error: 'Only a dispositioned NCR can be verified' }, { status: 400 });
  if (ncr.qc_verified_at) return NextResponse.json({ error: 'Already verified' }, { status: 400 });

  // Same physical-readiness check Close used to own alone — verification means confirming the
  // disposition was actually carried out, so a rework/repair card has to actually be done first.
  if (ncr.rework_job_card_id) {
    const card = await queryOne('SELECT status FROM job_cards WHERE id = ?', [ncr.rework_job_card_id]);
    if (!card || card.status !== 'done') {
      return NextResponse.json({ error: 'Rework job card is not finished yet' }, { status: 400 });
    }
  }

  await execute(
    'UPDATE ncr_records SET qc_verified_at = CURRENT_TIMESTAMP, qc_verified_by = ? WHERE id = ?',
    [user.username, params.id]
  );
  await audit('ncr_verified', { actor: user.username, detail: ncr.ncr_no });
  return NextResponse.json({ ok: true });
}
