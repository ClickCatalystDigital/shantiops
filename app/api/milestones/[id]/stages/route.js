// Add a stage to one milestone's own instance list, or bulk-copy a named stage_template's items
// onto it (apply_template_id) — see the milestone_stages/stage_templates comment in lib/db.js for
// the model. Auth mirrors app/api/milestones/[id]/route.js: a head may only touch a milestone in a
// department they're granted.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const m = await queryOne('SELECT id, department, milestone_key FROM milestones WHERE id = ?', [params.id]);
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isHead(user) && !canAccessDepartment(user, m.department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const existing = await queryAll('SELECT id FROM milestone_stages WHERE milestone_id = ?', [params.id]);

  if (b.apply_template_id) {
    if (existing.length) return NextResponse.json({ error: 'This milestone already has stages' }, { status: 400 });
    // Scoped to this milestone's own (department, milestone_key) — a forged id from a different
    // type never applies here, same trust boundary as the milestones PATCH route's field whitelist.
    const template = await queryOne(
      'SELECT id FROM stage_templates WHERE id = ? AND department = ? AND milestone_key = ?',
      [b.apply_template_id, m.department, m.milestone_key]
    );
    if (!template) return NextResponse.json({ error: 'Template not found for this milestone type' }, { status: 404 });
    const items = await queryAll(
      'SELECT label, sort_order FROM stage_template_items WHERE template_id = ? ORDER BY sort_order',
      [template.id]
    );
    for (const it of items) {
      await execute(
        'INSERT INTO milestone_stages (milestone_id, label, sort_order, status) VALUES (?, ?, ?, ?)',
        [params.id, it.label, it.sort_order, 'open']
      );
    }
    await audit('stage_template_applied', {
      actor: user.username,
      detail: `milestone ${params.id} (${m.milestone_key}): template ${template.id}, ${items.length} stages`,
    });
    return NextResponse.json({ ok: true });
  }

  const label = String(b.label || '').trim();
  if (!label) return NextResponse.json({ error: 'A stage name is required' }, { status: 400 });

  await execute(
    'INSERT INTO milestone_stages (milestone_id, label, sort_order, status) VALUES (?, ?, ?, ?)',
    [params.id, label, existing.length, 'open']
  );
  await audit('stage_added', { actor: user.username, detail: `milestone ${params.id} (${m.milestone_key}): ${label}` });
  return NextResponse.json({ ok: true });
}
