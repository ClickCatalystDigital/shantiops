import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextNumber } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { CALL_TYPES } from '@/lib/installation-report-template.mjs';
import { signatureError } from '@/lib/installation-report-template.mjs';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const pid = sp.get('project_id'), cid = sp.get('service_customer_id');
  const where = pid ? 'WHERE r.project_id = ?' : cid ? 'WHERE r.service_customer_id = ?' : '';
  return NextResponse.json(await queryAll(
    `SELECT r.id, r.report_no, r.project_id, r.service_customer_id, r.call_type, r.report_date, r.created_by, r.updated_at, r.finalized_at, r.customer_visible, r.doc_no, r.revision,
            p.service_reports_customer_visible AS project_visible, p.project_no, COALESCE(p.customer_name, sc.name) AS customer_name
       FROM installation_reports r LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN service_third_party_customers sc ON sc.id = r.service_customer_id
      ${where} ORDER BY r.id DESC`, pid ? [pid] : cid ? [cid] : []));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.report.write');
  if (denied) return denied;
  const b = await req.json();
  // A report is for a project, or for a service-only customer (no project) — exactly one of the two.
  const projectId = Number(b.project_id) || null, customerId = projectId ? null : Number(b.service_customer_id) || null;
  if (!projectId && !customerId) return NextResponse.json({ error: 'Pick a project or a customer' }, { status: 400 });
  if (customerId && !(await queryOne('SELECT 1 AS x FROM service_third_party_customers WHERE id = ?', [customerId]))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  if (!CALL_TYPES.includes(b.call_type)) return NextResponse.json({ error: 'Pick a call type' }, { status: 400 });
  const badSig = signatureError(b.data);
  if (badSig) return NextResponse.json({ error: badSig }, { status: 400 });
  const reportNo = await nextNumber('installation_report_no', 'FSR');
  const { lastId } = await execute(
    `INSERT INTO installation_reports (report_no, project_id, service_customer_id, call_type, report_date, data_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reportNo, projectId, customerId, b.call_type, b.report_date || null, JSON.stringify(b.data || {}), user.username]
  );
  await audit('installation_report_created', { actor: user.username, detail: `${reportNo} (${b.call_type}) ${projectId ? `project ${projectId}` : `service customer ${customerId}`}` });
  return NextResponse.json({ id: Number(lastId), report_no: reportNo });
}
