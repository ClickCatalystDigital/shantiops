// Save a named stage template — the normal path is "shape a milestone's own stage list, then save
// it as a reusable template" (StagesPanel's Manage tab), so creation always carries its starting
// items rather than beginning blank.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const department = b.department;
  const milestoneKey = String(b.milestone_key || '').trim();
  const name = String(b.name || '').trim();
  const items = Array.isArray(b.items) ? b.items.map(s => String(s).trim()).filter(Boolean) : [];

  if (!DEPARTMENTS.includes(department)) return NextResponse.json({ error: 'Invalid department' }, { status: 400 });
  if (!milestoneKey) return NextResponse.json({ error: 'Missing milestone type' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'A template name is required' }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: 'At least one stage is required' }, { status: 400 });
  if (isHead(user) && !canAccessDepartment(user, department)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tpl = await execute(
      'INSERT INTO stage_templates (department, milestone_key, name) VALUES (?, ?, ?)',
      [department, milestoneKey, name]
    );
    const templateId = Number(tpl.lastId);
    for (let i = 0; i < items.length; i++) {
      await execute(
        'INSERT INTO stage_template_items (template_id, label, sort_order) VALUES (?, ?, ?)',
        [templateId, items[i], i]
      );
    }
    await audit('stage_template_created', {
      actor: user.username, detail: `${department}/${milestoneKey}: "${name}" (${items.length} stages)`,
    });
    return NextResponse.json({ id: templateId });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json({ error: 'A template with that name already exists for this milestone type' }, { status: 409 });
    }
    throw e;
  }
}
