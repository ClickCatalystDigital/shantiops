// Multi-unit BOM split (MULTI-UNIT-SPLIT-DESIGN.md, Phase 2) — the deliberate, one-time action that
// turns a master project's unit_count into N real per-unit child projects (SB-1109-01..N) for the
// departments whose work is inherently per-physical-unit (QC/Production/Dispatch, §4). Same
// authority tier as "Release BOM" (canRelease in release-bom/route.js) — this is squarely a
// Design/Engineering decision, made once the master BOM is finalized.
//
// Explicitly does NOT clone bom_items/bom_assemblies into each child (confirmed architecture,
// §1.2/§6 of the design doc) — Procurement/Stores keep working the master's own BOM. A freshly-split
// child gets only: an identity, the full unchanged milestone template, and the master_project_id
// link. Post-split quantity changes are not supported in v1 (§5.5, resolved) — a master can only be
// split once; the guard below is also what makes this action idempotent/safe to retry.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction, createProjectMilestones } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';

function canSplit(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

// Status check for the split UI — whether this project can be split, already has children, or is
// itself a child (can never be split). Mirrors release-bom/route.js's GET shape.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canSplit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const project = await queryOne(
    'SELECT id, project_no, unit_count, master_project_id, bom_release_revision FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const children = await queryAll(
    'SELECT id, project_no, unit_no, status FROM projects WHERE master_project_id = ? ORDER BY unit_no', [project.id]);
  const unitCount = Math.round(Number(project.unit_count) || 1);
  return NextResponse.json({
    isChild: !!project.master_project_id,
    alreadySplit: children.length > 0,
    unitCount,
    canSplitNow: !project.master_project_id && children.length === 0 && unitCount >= 2 && !!project.bom_release_revision,
    bomReleased: !!project.bom_release_revision,
    children,
  });
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canSplit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const master = await queryOne('SELECT * FROM projects WHERE id = ?', [params.id]);
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (master.master_project_id) {
    return NextResponse.json({ error: 'This is already a child project — only a master project can be split' }, { status: 400 });
  }
  // Idempotency/atomicity guard (§5.8, hard requirement): a master can only ever be split once. A
  // genuinely failed prior attempt leaves zero children (the transaction below rolls back whole),
  // so retrying after a real failure is always safe — this only blocks re-running after success.
  const existingChildren = await queryOne('SELECT COUNT(*) AS n FROM projects WHERE master_project_id = ?', [master.id]);
  if (Number(existingChildren.n) > 0) {
    return NextResponse.json({ error: 'This project has already been split — a master can only be split once' }, { status: 409 });
  }
  const unitCount = Math.round(Number(master.unit_count) || 1);
  if (unitCount < 2) {
    return NextResponse.json({ error: 'Set a Unit Count of 2 or more before splitting — nothing to split for a single-unit project' }, { status: 400 });
  }
  // "Once the master BOM is finalized" (§1.3, confirmed architecture) — bom_release_revision > 0
  // means Release BOM has fired at least once.
  if (!master.bom_release_revision) {
    return NextResponse.json({ error: 'Release the BOM at least once before splitting into unit projects' }, { status: 400 });
  }

  // Numbering zero-pad width computed from unit count (§5.12, resolved) — handles both <=99 and
  // 100+ unit orders with the same code path, never hardcoded to 2 digits.
  const padWidth = Math.max(2, String(unitCount).length);
  const todayStr = new Date().toISOString().slice(0, 10);
  const start = master.order_date && master.order_date > todayStr ? new Date(master.order_date) : new Date();
  const startDaysAgo = Math.round((Date.now() - start.getTime()) / 864e5);

  let childIds;
  try {
    childIds = await withTransaction(async tx => {
      const ids = [];
      for (let i = 1; i <= unitCount; i++) {
        const childProjectNo = `${master.project_no}-${String(i).padStart(padWidth, '0')}`;
        const r = await tx.execute({
          sql: `INSERT INTO projects (project_no, customer_name, description, order_date, owner, customer_id, sale_order_id, series, company, master_project_id, unit_no)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [childProjectNo, master.customer_name, master.description, master.order_date, user?.username || null,
            master.customer_id, master.sale_order_id, master.series, master.company, master.id, i],
        });
        const childId = Number(r.lastInsertRowid);
        // Full, unchanged milestone template (§5.milestones-per-child, resolved) — a child is an
        // ordinary project as far as milestones are concerned; Design/Procurement-stage milestones
        // on a child simply see no real action (those departments work the master), reading as
        // permanently "not started" rather than needing a second, child-specific template.
        await createProjectMilestones(tx, childId, startDaysAgo, false);
        ids.push(childId);
      }
      return ids;
    });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json(
        { error: 'One of the generated child project numbers already exists — check for a naming collision before retrying' },
        { status: 409 });
    }
    throw e;
  }

  await audit('project_split', {
    actor: user.username, detail: `${master.project_no} -> ${childIds.length} child units (${childIds.join(',')})`,
  });
  try {
    const note = {
      kind: 'project_split', title: `${master.project_no} split into ${childIds.length} units`,
      body: 'Individual unit projects are ready for execution tracking.',
      dedupe_key: `project_split:${master.id}`,
    };
    await notifyDepartment('Production', note);
    await notifyDepartment('QC', note);
    await notifyDepartment('Dispatch', note);
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, childIds, unitCount: childIds.length });
}
