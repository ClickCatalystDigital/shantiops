// Add a stage to one milestone's own instance list, or apply-template to bulk-copy the department's
// reusable stage_templates rows for this milestone's type — see the milestone_stages/stage_templates
// comment in lib/db.js for the model. Auth mirrors app/api/milestones/[id]/route.js: a head may only
// touch a milestone in a department they're granted.
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

  if (b.apply_template) {
    if (existing.length) return NextResponse.json({ error: 'This milestone already has stages' }, { status: 400 });
    const template = await queryAll(
      'SELECT label, sort_order FROM stage_templates WHERE department = ? AND milestone_key = ? ORDER BY sort_order',
      [m.department, m.milestone_key]
    );
    if (!template.length) return NextResponse.json({ error: 'No template exists for this milestone type yet' }, { status: 400 });
    for (const t of template) {
      await execute(
        'INSERT INTO milestone_stages (milestone_id, label, sort_order, status) VALUES (?, ?, ?, ?)',
        [params.id, t.label, t.sort_order, 'open']
      );
    }
    await audit('stage_template_applied', {
      actor: user.username,
      detail: `milestone ${params.id} (${m.milestone_key}): ${template.length} stages`,
    });
    return NextResponse.json({ ok: true });
  }

  const label = String(b.label || '').trim();
  if (!label) return NextResponse.json({ error: 'A stage name is required' }, { status: 400 });

  await execute(
    'INSERT INTO milestone_stages (milestone_id, label, sort_order, status) VALUES (?, ?, ?, ?)',
    [params.id, label, existing.length, 'open']
  );

  // Grows the reusable template from real usage — the first project to name a stage for this
  // milestone type sets the default the next one can Apply template from. INSERT OR IGNORE: a
  // label already in the template is a silent no-op, not a duplicate (UNIQUE(department,
  // milestone_key, label)).
  const templateMax = await queryOne(
    'SELECT COALESCE(MAX(sort_order), -1) AS n FROM stage_templates WHERE department = ? AND milestone_key = ?',
    [m.department, m.milestone_key]
  );
  await execute(
    'INSERT OR IGNORE INTO stage_templates (department, milestone_key, label, sort_order) VALUES (?, ?, ?, ?)',
    [m.department, m.milestone_key, label, templateMax.n + 1]
  );

  await audit('stage_added', { actor: user.username, detail: `milestone ${params.id} (${m.milestone_key}): ${label}` });
  return NextResponse.json({ ok: true });
}
