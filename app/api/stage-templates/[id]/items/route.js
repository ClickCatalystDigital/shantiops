import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const tpl = await queryOne('SELECT * FROM stage_templates WHERE id = ?', [params.id]);
  if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, tpl.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const label = String(b.label || '').trim();
  if (!label) return NextResponse.json({ error: 'A stage name is required' }, { status: 400 });

  const max = await queryOne('SELECT COALESCE(MAX(sort_order), -1) AS n FROM stage_template_items WHERE template_id = ?', [tpl.id]);
  await execute(
    'INSERT INTO stage_template_items (template_id, label, sort_order) VALUES (?, ?, ?)',
    [tpl.id, label, max.n + 1]
  );
  await audit('stage_template_item_added', { actor: user.username, detail: `template ${tpl.id}: ${label}` });
  return NextResponse.json({ ok: true });
}
