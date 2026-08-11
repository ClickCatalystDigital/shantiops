import { NextResponse } from 'next/server';
import { execute, nextNumber, initDB, createProjectMilestones } from '@/lib/db';
import { getSessionUser, requirePM } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = getSessionUser();
  const denied = requirePM(user); // project creation is PM/engineering-only
  if (denied) return denied;
  const b = await req.json();
  if (!b.customer_name?.trim()) {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
  }
  const project_no = b.project_no?.trim() || (await nextNumber('project_no', 'SB'));
  try {
    // customer_id/sale_order_id — V3_CHANGES.md §12 Phase 2f, the Lead→Customer→Quotation→Sale
    // Order→Project chain's final link. Both additive/nullable; customer_name stays NOT NULL and
    // required exactly as before, so the 6 pre-existing free-text-only projects are unaffected.
    const r = await execute(
      `INSERT INTO projects (project_no, customer_name, description, order_date, owner, customer_id, sale_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [project_no, b.customer_name.trim(), b.description || null, b.order_date || null, user?.username || null,
        b.customer_id || null, b.sale_order_id || null]
    );
    const projectId = Number(r.lastId);
    // Seed the full milestone chain with planned dates so the tracker is alive from day one —
    // schedule starts today (or the order date, if it's in the future: a past order date must not
    // make a brand-new project instantly overdue). All statuses pending; the PM adjusts from there.
    const todayStr = new Date().toISOString().slice(0, 10);
    const start = b.order_date && b.order_date > todayStr ? new Date(b.order_date) : new Date();
    const startDaysAgo = Math.round((Date.now() - start.getTime()) / 864e5);
    await createProjectMilestones(await initDB(), projectId, startDaysAgo, false);
    await audit('project_created', { actor: user.username, detail: `${project_no} · ${b.customer_name.trim()}` });
    return NextResponse.json({ id: projectId, project_no });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json({ error: `Project ${project_no} already exists` }, { status: 409 });
    }
    throw e;
  }
}
