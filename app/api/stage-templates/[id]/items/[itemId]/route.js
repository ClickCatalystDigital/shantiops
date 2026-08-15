// Rename an item, nudge it up/down (swap sort_order with its neighbor), or remove it.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

async function load(templateId, itemId) {
  const tpl = await queryOne('SELECT * FROM stage_templates WHERE id = ?', [templateId]);
  const item = tpl && await queryOne('SELECT * FROM stage_template_items WHERE id = ? AND template_id = ?', [itemId, templateId]);
  return { tpl, item };
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { tpl, item } = await load(params.id, params.itemId);
  if (!tpl || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, tpl.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  if ('label' in b) {
    const label = String(b.label || '').trim();
    if (!label) return NextResponse.json({ error: 'A stage name is required' }, { status: 400 });
    await execute('UPDATE stage_template_items SET label = ? WHERE id = ?', [label, item.id]);
    await audit('stage_template_item_renamed', { actor: user.username, detail: `template ${tpl.id} item ${item.id}: ${item.label} -> ${label}` });
    return NextResponse.json({ ok: true });
  }

  if (b.direction === 'up' || b.direction === 'down') {
    const siblings = await queryAll('SELECT id, sort_order FROM stage_template_items WHERE template_id = ? ORDER BY sort_order', [tpl.id]);
    const idx = siblings.findIndex(s => s.id === item.id);
    const swapIdx = b.direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return NextResponse.json({ error: 'Already at the edge' }, { status: 400 });
    const neighbor = siblings[swapIdx];
    await execute('UPDATE stage_template_items SET sort_order = ? WHERE id = ?', [neighbor.sort_order, item.id]);
    await execute('UPDATE stage_template_items SET sort_order = ? WHERE id = ?', [item.sort_order, neighbor.id]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { tpl, item } = await load(params.id, params.itemId);
  if (!tpl || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, tpl.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await execute('DELETE FROM stage_template_items WHERE id = ?', [item.id]);
  await audit('stage_template_item_removed', { actor: user.username, detail: `template ${tpl.id}: ${item.label}` });
  return NextResponse.json({ ok: true });
}
