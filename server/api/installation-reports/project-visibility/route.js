// Project-level switch: the customer can open every finalized service report of this project
// (the per-report "Show to customer" switch still works on its own).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { notifyProjectCustomers } from '@/lib/notify';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const p = await queryOne('SELECT service_reports_customer_visible AS visible FROM projects WHERE id = ?', [new URL(req.url).searchParams.get('project_id')]);
  return NextResponse.json({ visible: !!p?.visible });
}

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.report.write');
  if (denied) return denied;
  const b = await req.json();
  const p = await queryOne('SELECT id, project_no, service_reports_customer_visible AS visible FROM projects WHERE id = ?', [b.project_id]);
  if (!p) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const on = b.visible ? 1 : 0;
  await execute('UPDATE projects SET service_reports_customer_visible = ? WHERE id = ?', [on, p.id]);
  await audit('installation_reports_project_visibility', { actor: user.username, detail: `${p.project_no}: ${on ? 'on' : 'off'}` });
  if (on && !p.visible) {
    try { await notifyProjectCustomers(p.id, { kind: 'installation_report_shared', title: 'Service reports available', body: 'Your service reports are ready to download.', dedupe_key: `service_reports_shared:${p.id}` }); } catch { /* non-fatal */ }
  }
  return NextResponse.json({ ok: true, visible: !!on });
}
