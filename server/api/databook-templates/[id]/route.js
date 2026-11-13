// Save a Data Book template (whole list), or make it the default one new books start from.
import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { readTemplate } from '../route';

export async function PUT(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.databook.template'));
  if (denied) return denied;
  const old = await queryOne('SELECT * FROM databook_templates WHERE id = ?', [params.id]);
  if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const t = readTemplate(b);
  if (t.errors.length) return NextResponse.json({ error: t.errors.join('; ') }, { status: 400 });
  try {
    await withTransaction(async tx => {
      // Books store the template's name; keep them pointing at it when it's renamed.
      await tx.execute({ sql: 'UPDATE databook_templates SET name = ?, form_no = ?, lines_json = ? WHERE id = ?', args: [t.name, t.form_no, JSON.stringify(t.lines), old.id] });
      if (t.name !== old.name) await tx.execute({ sql: 'UPDATE databooks SET template_name = ? WHERE template_name = ?', args: [t.name, old.name] });
      if (b.is_default) {
        await tx.execute('UPDATE databook_templates SET is_default = 0');
        await tx.execute({ sql: 'UPDATE databook_templates SET is_default = 1 WHERE id = ?', args: [old.id] });
      }
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return NextResponse.json({ error: 'A template with that name exists' }, { status: 409 });
    throw e;
  }
  await audit('databook_template_saved', { actor: user.username, detail: `${t.name} (${t.lines.length} lines)` });
  return NextResponse.json({ ok: true });
}
