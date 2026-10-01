import { NextResponse } from 'next/server';
import { execute, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { CALL_TYPES } from '@/lib/installation-report-template.mjs';
import { signatureError } from '@/lib/installation-report-template.mjs';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const pid = new URL(req.url).searchParams.get('project_id');
  return NextResponse.json(await queryAll(
    `SELECT r.id, r.report_no, r.project_id, r.call_type, r.report_date, r.created_by, r.updated_at, r.finalized_at, r.customer_visible, r.doc_no, r.revision, p.service_reports_customer_visible AS project_visible, p.project_no, p.customer_name
       FROM installation_reports r JOIN projects p ON p.id = r.project_id
      ${pid ? 'WHERE r.project_id = ?' : ''} ORDER BY r.id DESC`, pid ? [pid] : []));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.report.write');
  if (denied) return denied;
  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'Project is required' }, { status: 400 });
  if (!CALL_TYPES.includes(b.call_type)) return NextResponse.json({ error: 'Pick a call type' }, { status: 400 });
  const badSig = signatureError(b.data);
  if (badSig) return NextResponse.json({ error: badSig }, { status: 400 });
  const reportNo = await nextNumber('installation_report_no', 'FSR');
  const { lastId } = await execute(
    `INSERT INTO installation_reports (report_no, project_id, call_type, report_date, data_json, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [reportNo, b.project_id, b.call_type, b.report_date || null, JSON.stringify(b.data || {}), user.username]
  );
  await audit('installation_report_created', { actor: user.username, detail: `${reportNo} (${b.call_type}) project ${b.project_id}` });
  return NextResponse.json({ id: Number(lastId), report_no: reportNo });
}
