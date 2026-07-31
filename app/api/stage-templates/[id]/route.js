// Rename a template, mark it the default for its (department, milestone_key) — clearing any other
// default for the same pair first, since exactly one can auto-copy at project creation — or delete
// it (cascades to stage_template_items).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

async function loadTemplate(id) {
  return queryOne('SELECT * FROM stage_templates WHERE id = ?', [id]);
}

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const tpl = await loadTemplate(params.id);
  if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, tpl.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  if ('name' in b) {
    const name = String(b.name || '').trim();
    if (!name) return NextResponse.json({ error: 'A template name is required' }, { status: 400 });
    try {
      await execute('UPDATE stage_templates SET name = ? WHERE id = ?', [name, tpl.id]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) {
        return NextResponse.json({ error: 'A template with that name already exists for this milestone type' }, { status: 409 });
      }
      throw e;
    }
    await audit('stage_template_renamed', { actor: user.username, detail: `template ${tpl.id}: ${tpl.name} -> ${name}` });
  }
  if (b.is_default) {
    await execute(
      'UPDATE stage_templates SET is_default = 0 WHERE department = ? AND milestone_key = ?',
      [tpl.department, tpl.milestone_key]
    );
    await execute('UPDATE stage_templates SET is_default = 1 WHERE id = ?', [tpl.id]);
    await audit('stage_template_defaulted', { actor: user.username, detail: `template ${tpl.id} (${tpl.department}/${tpl.milestone_key})` });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const tpl = await loadTemplate(params.id);
  if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, tpl.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await execute('DELETE FROM stage_templates WHERE id = ?', [tpl.id]);
  await audit('stage_template_deleted', { actor: user.username, detail: `${tpl.department}/${tpl.milestone_key}: "${tpl.name}"` });
  return NextResponse.json({ ok: true });
}
