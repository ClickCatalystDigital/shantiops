import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { cleanItems } from '@/lib/itp-template.mjs';
import { audit } from '@/lib/usb';
import { insertTemplateItems as insertItems } from '@/lib/quality';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC') && !canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const t = await queryOne('SELECT * FROM itp_templates WHERE id = ?', [params.id]);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...t, items: await queryAll('SELECT * FROM itp_template_items WHERE template_id = ? ORDER BY sort_order', [t.id]) });
}

// Whole save: name, revision and the full point list.
export async function PUT(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.itp.template'));
  if (denied) return denied;
  const t = await queryOne('SELECT * FROM itp_templates WHERE id = ? AND active = 1', [params.id]);
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const name = String(b.name ?? t.name).trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const { items, errors } = cleanItems(b.items || []);
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
  try {
    await withTransaction(async tx => {
      await tx.execute({ sql: 'UPDATE itp_templates SET name = ?, revision = ? WHERE id = ?', args: [name, String(b.revision ?? t.revision ?? '').trim() || null, t.id] });
      await tx.execute({ sql: 'DELETE FROM itp_template_items WHERE template_id = ?', args: [t.id] });
      await insertItems(tx, t.id, items);
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return NextResponse.json({ error: 'A template with that name exists' }, { status: 409 });
    throw e;
  }
  await audit('itp_template_saved', { actor: user.username, detail: `${name} · ${items.length} points` });
  return NextResponse.json({ ok: true });
}

// A template used by a card is archived, not deleted (the card keeps its own copy of the points).
export async function DELETE(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.itp.template'));
  if (denied) return denied;
  const used = await queryOne('SELECT 1 FROM job_sheets WHERE itp_template_id = ? LIMIT 1', [params.id]);
  if (used) await execute('UPDATE itp_templates SET active = 0 WHERE id = ?', [params.id]);
  else await execute('DELETE FROM itp_templates WHERE id = ?', [params.id]);
  await audit(used ? 'itp_template_archived' : 'itp_template_deleted', { actor: user.username, detail: `template ${params.id}` });
  return NextResponse.json({ ok: true, archived: !!used });
}
