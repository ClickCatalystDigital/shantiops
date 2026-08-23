// NCR register — list/create. QC and Production both have a real stake: a foreman can raise an
// NCR directly against a field-found defect (plan §5b access decision), and needs to see it again
// afterward, so GET matches POST's gate exactly, not narrowed to QC-only.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

function canTouch(user) {
  return canAccessDepartment(user, 'QC') || canAccessDepartment(user, 'Production');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const projectId = params.get('project_id');
  const status = params.get('status');
  const where = [];
  const args = [];
  if (projectId) { where.push('project_id = ?'); args.push(Number(projectId)); }
  if (status) { where.push('status = ?'); args.push(status); }
  const sql = `SELECT * FROM ncr_records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`;
  return NextResponse.json(await queryAll(sql, args));
}

// Never trust the client for project_id — derive it server-side from whichever link is supplied,
// same discipline job_cards/bom_items use elsewhere. Priority: qc_record_id, then bom_item_id, then
// work_order_id, then job_card_id, then a bare project_id in the body when none of the four apply
// (a field-found defect with no upstream link yet).
async function resolveProjectId(b) {
  if (b.qc_record_id) {
    const row = await queryOne('SELECT project_id FROM qc_records WHERE id = ?', [Number(b.qc_record_id)]);
    if (row) return row.project_id;
  }
  if (b.bom_item_id) {
    const row = await queryOne('SELECT project_id FROM bom_items WHERE id = ?', [Number(b.bom_item_id)]);
    if (row) return row.project_id;
  }
  if (b.work_order_id) {
    const row = await queryOne('SELECT project_id FROM work_orders WHERE id = ?', [Number(b.work_order_id)]);
    if (row) return row.project_id;
  }
  if (b.job_card_id) {
    const row = await queryOne('SELECT project_id FROM job_cards WHERE id = ?', [Number(b.job_card_id)]);
    if (row) return row.project_id;
  }
  return b.project_id ? Number(b.project_id) : null;
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, canAccessDepartment(user, 'QC') ? 'QC' : 'Production', 'qc.ncr.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!String(b.description || '').trim()) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  }
  const projectId = await resolveProjectId(b);
  if (!projectId) return NextResponse.json({ error: "Couldn't determine which project this NCR belongs to" }, { status: 400 });

  // Duplicate guard — without this, QC and Production could each raise a separate NCR against the
  // same failed test.
  if (b.qc_record_id) {
    const dup = await queryOne(
      "SELECT id FROM ncr_records WHERE qc_record_id = ? AND status IN ('open','dispositioned')",
      [Number(b.qc_record_id)]
    );
    if (dup) return NextResponse.json({ error: `Already covered by NCR #${dup.id}` }, { status: 409 });
  }

  // Hold-point linkage guard (2026-08-23 hardening pass) — qc_records carries no job_card_id column
  // of its own, so an NCR raised from a failed test (QcPanel's "Raise NCR" button) has no automatic
  // way to know which held job card, if any, it's about. Rather than silently letting that link go
  // missing whenever the project actually has a card on hold, require the caller to either name the
  // affected job_card_id or explicitly confirm the NCR isn't hold-related — real server-side
  // enforcement, not just a UI nicety (the UI only makes the common no-holds-in-project case fast).
  if (b.qc_record_id && !b.job_card_id && !b.not_hold_related) {
    const held = await queryOne(
      "SELECT id FROM job_cards WHERE project_id = ? AND requires_qc_hold = 1 AND qc_released_at IS NULL LIMIT 1",
      [projectId]
    );
    if (held) {
      return NextResponse.json({
        error: 'This project has a job card on QC hold — link this NCR to the affected job card, or confirm it is unrelated.',
      }, { status: 400 });
    }
  }

  const ncrNo = await nextNumber('ncr_no', 'NCR');
  const { lastId } = await execute(
    `INSERT INTO ncr_records
       (ncr_no, project_id, qc_record_id, bom_item_id, work_order_id, job_card_id, stock_piece_id,
        description, severity, raised_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ncrNo, projectId, b.qc_record_id ? Number(b.qc_record_id) : null, b.bom_item_id ? Number(b.bom_item_id) : null,
      b.work_order_id ? Number(b.work_order_id) : null, b.job_card_id ? Number(b.job_card_id) : null,
      b.stock_piece_id ? Number(b.stock_piece_id) : null, String(b.description).trim(),
      ['minor', 'major', 'critical'].includes(b.severity) ? b.severity : 'minor', user.username]
  );
  const id = Number(lastId);

  // Outside the transaction-free insert above (there's no multi-write transaction here to begin
  // with) but still after the commit conceptually — matches the codebase convention of keeping
  // notify/audit as external side effects, not gating the write on them.
  await audit('ncr_raised', { actor: user.username, detail: `${ncrNo} · project ${projectId}` });
  try {
    await notifyDepartment(b.bom_item_id ? 'Procurement' : 'Production', {
      kind: 'ncr_raised', title: `NCR raised: ${ncrNo}`, project_id: projectId,
      dedupe_key: `ncr_raised:${id}`,
    });
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ id, ncr_no: ncrNo });
}
