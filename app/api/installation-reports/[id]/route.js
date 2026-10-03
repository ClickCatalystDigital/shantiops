import { NextResponse } from 'next/server';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { signatureError, finalizeDoc } from '@/lib/installation-report-template.mjs';
import { notifyProjectCustomers } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { syncCommissioningMilestone } from '@/lib/milestone-auto';

async function load(write) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (write) { const denied = await requireAction(user, 'Installation', 'installation.report.write'); if (denied) return { res: denied }; }
  return { user };
}

export async function GET(req, { params }) {
  const { res } = await load(false);
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT r.*, p.project_no, p.customer_name FROM installation_reports r JOIN projects p ON p.id = r.project_id WHERE r.id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...row, data: JSON.parse(row.data_json || '{}') });
}

// Body is either { data, report_date } (edit — only while not finalized) or { action } where action is
// finalize | reopen | share | unshare. Only a finalized report can be shared with the customer (any call type).
export async function PATCH(req, { params }) {
  const { user, res } = await load(true);
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT * FROM installation_reports WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();

  if (b.action) {
    if (b.action === 'finalize') {
      if (row.finalized_at) return NextResponse.json({ error: 'Already finalized' }, { status: 409 });
      // Commissioning: SB-COM-nnn on first finalize, Rev goes up each time a reopened report is finalized again.
      const needsNo = row.call_type === 'Commissioning' && !row.doc_no;
      const doc = finalizeDoc(row, needsNo ? await nextCounterValue('commissioning_doc_no', 0) : 0);
      await execute('UPDATE installation_reports SET finalized_at = CURRENT_TIMESTAMP, finalized_by = ?, doc_no = COALESCE(?, doc_no), revision = COALESCE(?, revision) WHERE id = ?',
        [user.username, doc.doc_no ?? null, doc.revision ?? null, id]);
      // A finalized Commissioning report is the real sign-off: it completes the Commissioning milestone.
      if (row.call_type === 'Commissioning') try { await syncCommissioningMilestone(row.project_id, user.username); } catch { /* best-effort */ }
    } else if (b.action === 'reopen') {
      // Reopening also withdraws it from the customer — an editable report must not stay published.
      await execute('UPDATE installation_reports SET finalized_at = NULL, finalized_by = NULL, customer_visible = 0, customer_visible_at = NULL WHERE id = ?', [id]);
    } else if (b.action === 'share') {
      if (!row.finalized_at) return NextResponse.json({ error: 'Finalize the report before sharing it' }, { status: 409 });
      if (!row.customer_visible) {
        await execute('UPDATE installation_reports SET customer_visible = 1, customer_visible_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        // Best effort; only on the real 0 -> 1 flip.
        try { await notifyProjectCustomers(row.project_id, { kind: 'installation_report_shared', title: `${row.call_type} report available`, body: `Your ${row.call_type.toLowerCase()} report ${row.report_no} is ready to download.`, dedupe_key: `installation_report_shared:${id}` }); } catch { /* non-fatal */ }
      }
    } else if (b.action === 'unshare') {
      await execute('UPDATE installation_reports SET customer_visible = 0, customer_visible_at = NULL WHERE id = ?', [id]);
    } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    await audit(`installation_report_${b.action}`, { actor: user.username, detail: row.report_no });
    return NextResponse.json({ ok: true });
  }

  if (row.finalized_at) return NextResponse.json({ error: 'This report is finalized — reopen it to edit' }, { status: 409 });
  const badSig = signatureError(b.data);
  if (badSig) return NextResponse.json({ error: badSig }, { status: 400 });
  await execute('UPDATE installation_reports SET data_json = ?, report_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(b.data || {}), b.report_date !== undefined ? (b.report_date || null) : row.report_date, id]);
  await audit('installation_report_edit', { actor: user.username, detail: row.report_no });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { user, res } = await load(true);
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT finalized_at FROM installation_reports WHERE id = ?', [id]);
  if (row?.finalized_at) return NextResponse.json({ error: 'A finalized report can\'t be deleted — reopen it first' }, { status: 409 });
  await execute('DELETE FROM installation_reports WHERE id = ?', [id]);
  await audit('installation_report_deleted', { actor: user.username, detail: `report ${id}` });
  return NextResponse.json({ ok: true });
}
