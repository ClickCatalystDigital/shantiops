// ITP templates (docs/gulf-coast-asme-plan.md): a customer's Inspection & Test Plan as data. A job card made
// from one copies its points, so editing a template never changes cards already made.
import { NextResponse } from 'next/server';
import { queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { cleanItems } from '@/lib/itp-template.mjs';
import { audit } from '@/lib/usb';
import { insertTemplateItems as insertItems } from '@/lib/quality';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC') && !canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll(`SELECT t.*, (SELECT COUNT(*) FROM itp_template_items i WHERE i.template_id = t.id) AS points,
    (SELECT COUNT(*) FROM job_sheets js WHERE js.itp_template_id = t.id) AS cards FROM itp_templates t WHERE t.active = 1 ORDER BY t.name`));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.itp.template'));
  if (denied) return denied;
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const { items, errors } = cleanItems(b.items || []);
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
  try {
    const id = await withTransaction(async tx => {
      const r = await tx.execute({ sql: 'INSERT INTO itp_templates (name, revision, created_by) VALUES (?, ?, ?)', args: [name, String(b.revision || '').trim() || null, user.username] });
      const tid = Number(r.lastInsertRowid);
      await insertItems(tx, tid, items);
      return tid;
    });
    await audit('itp_template_created', { actor: user.username, detail: `${name} · ${items.length} points` });
    return NextResponse.json({ id });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return NextResponse.json({ error: 'A template with that name exists' }, { status: 409 });
    throw e;
  }
}
