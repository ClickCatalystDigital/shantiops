// Customer remarks from earlier reports on a project (any call type), newest first — so a Breakdown/ASC
// visit can see what the customer said at commissioning.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const pid = Number(sp.get('project_id')), cid = Number(sp.get('service_customer_id'));
  if (!pid && !cid) return NextResponse.json({ error: 'project_id or service_customer_id is required' }, { status: 400 });
  const rows = await queryAll(
    `SELECT id, report_no, call_type, report_date, updated_at, data_json FROM installation_reports WHERE ${pid ? 'project_id' : 'service_customer_id'} = ? AND id != ? ORDER BY updated_at DESC, id DESC`,
    [pid || cid, Number(sp.get('exclude')) || 0]);
  const out = [];
  for (const r of rows) {
    let remark = '';
    try { remark = String(JSON.parse(r.data_json || '{}').fields?.customer_remarks || '').trim(); } catch { /* bad json, skip */ }
    if (remark) out.push({ id: r.id, report_no: r.report_no, call_type: r.call_type, at: r.updated_at, remark });
  }
  return NextResponse.json(out);
}
