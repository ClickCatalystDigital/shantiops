// Multi-unit BOM split (MULTI-UNIT-SPLIT-DESIGN.md, Phase 2 + Phase E) — the deliberate action that
// turns a master project's unit_count into N real per-unit child projects (SB-1109-01..N) for the
// departments whose work is inherently per-physical-unit (QC/Production/Dispatch, §4). Same
// authority tier as "Release BOM" (canRelease in release-bom/route.js) — this is squarely a
// Design/Engineering decision, made once the master BOM is finalized.
//
// Explicitly does NOT clone bom_items/bom_assemblies into each child (confirmed architecture,
// §1.2/§6 of the design doc) — Procurement/Stores keep working the master's own BOM. A freshly-split
// child gets only: an identity, the full unchanged milestone template, and the master_project_id
// link.
//
// Post-split resize (Phase E, confirmed scope): "add more units" only, via {addUnits: N} on an
// already-split master. Cancelling a specific already-split child is explicitly out of scope — see
// the design doc's open question #5 and the plan that shipped this phase.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction, createProjectMilestones } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isInternal } from '@/lib/auth';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';

function canSplit(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

// Status check for the split UI — whether this project can be split, already has children, or is
// itself a child (can never be split). Mirrors release-bom/route.js's GET shape.
//
// Read-only, so gated broader than the POST split action itself (canSplit, Design/Engineering only):
// every batch-children panel (Production/QC/Dispatch/Stores) fetches THIS route to learn its own
// project's children — canSplit-gating the GET silently 403'd every one of those panels for any
// non-Design/Engineering/PM head, so they never rendered at all. isInternal is the real requirement.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

// Real bug found live-testing against SB-1109-01-50 (a real project whose own project_no already
// carries a legacy free-text "-01-50" unit-RANGE annotation, predating this feature): naively
// appending produced "SB-1109-01-50-01" instead of the confirmed design's "SB-1109-01". Strip a
// trailing two-number range suffix ("-NN-NN") from the master's own project_no before appending the
// new per-unit suffix; a project with no such pattern (the common case, e.g. "SB-1040") is
// completely unaffected.
function baseProjectNoFor(master) {
  return master.project_no.replace(/-\d+-\d+$/, '');
}

// Shared by both a fresh split and an add-units call — inserts child projects numbered
// startUnitNo..startUnitNo+count-1, each with the full unchanged milestone template (a child is an
// ordinary project as far as milestones are concerned; Design/Procurement-stage milestones on a
// child simply see no real action, reading as permanently "not started"). padWidth is computed off
// totalUnitCount (the final total after this call), not just this call's own count — accepted,
// documented edge case: if growth crosses a digit boundary (e.g. 99->100+), only the new children
// get the wider padding, existing ones keep their original width (real orders seen this session top
// out at 50; ponytail: a full renumber-on-crossing pass is a real upgrade path if that ever bites).
async function createChildUnits(tx, master, startUnitNo, count, totalUnitCount, user, startDaysAgo) {
  const padWidth = Math.max(2, String(totalUnitCount).length);
  const baseProjectNo = baseProjectNoFor(master);
  const ids = [];
  for (let i = startUnitNo; i < startUnitNo + count; i++) {
    const childProjectNo = `${baseProjectNo}-${String(i).padStart(padWidth, '0')}`;
    const r = await tx.execute({
      sql: `INSERT INTO projects (project_no, customer_name, description, order_date, owner, customer_id, sale_order_id, series, company, master_project_id, unit_no)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [childProjectNo, master.customer_name, master.description, master.order_date, user?.username || null,
        master.customer_id, master.sale_order_id, master.series, master.company, master.id, i],
    });
    const childId = Number(r.lastInsertRowid);
    await createProjectMilestones(tx, childId, startDaysAgo, false);
    ids.push(childId);
  }
  return ids;
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canSplit(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const master = await queryOne('SELECT * FROM projects WHERE id = ?', [params.id]);
  if (!master) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (master.master_project_id) {
    return NextResponse.json({ error: 'This is already a child project — only a master project can be split' }, { status: 400 });
  }

  const b = await req.json().catch(() => ({}));
  const addUnits = Math.round(Number(b.addUnits) || 0);

  // Idempotency/atomicity guard (§5.8, hard requirement): a fresh split can only ever happen once.
  // A genuinely failed prior attempt leaves zero children (the transaction below rolls back whole),
  // so retrying after a real failure is always safe.
  const existingChildren = await queryOne('SELECT COUNT(*) AS n FROM projects WHERE master_project_id = ?', [master.id]);
  const existingCount = Number(existingChildren.n);

  const todayStr = new Date().toISOString().slice(0, 10);
  const start = master.order_date && master.order_date > todayStr ? new Date(master.order_date) : new Date();
  const startDaysAgo = Math.round((Date.now() - start.getTime()) / 864e5);

  let childIds;
  let newUnitCount;

  if (existingCount > 0) {
    // Add-units path — the only supported post-split resize in v1. A bare re-POST with no addUnits
    // on an already-split master still 409s exactly as before this phase.
    if (addUnits < 1) {
      return NextResponse.json(
        { error: 'This project has already been split — a master can only be split once. Pass addUnits to grow it.' },
        { status: 409 });
    }
    newUnitCount = existingCount + addUnits;
    try {
      childIds = await withTransaction(async tx => {
        const ids = await createChildUnits(tx, master, existingCount + 1, addUnits, newUnitCount, user, startDaysAgo);
        await tx.execute({ sql: 'UPDATE projects SET unit_count = ? WHERE id = ?', args: [newUnitCount, master.id] });
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
    await audit('project_split_add_units', {
      actor: user.username, detail: `${master.project_no} +${childIds.length} units (${childIds.join(',')}), now ${newUnitCount} total`,
    });
  } else {
    // Fresh split path.
    newUnitCount = Math.round(Number(master.unit_count) || 1);
    if (newUnitCount < 2) {
      return NextResponse.json({ error: 'Set a Unit Count of 2 or more before splitting — nothing to split for a single-unit project' }, { status: 400 });
    }
    // "Once the master BOM is finalized" (§1.3, confirmed architecture) — bom_release_revision > 0
    // means Release BOM has fired at least once.
    if (!master.bom_release_revision) {
      return NextResponse.json({ error: 'Release the BOM at least once before splitting into unit projects' }, { status: 400 });
    }
    try {
      childIds = await withTransaction(tx => createChildUnits(tx, master, 1, newUnitCount, newUnitCount, user, startDaysAgo));
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
  }

  try {
    const note = existingCount > 0
      ? { kind: 'project_split', title: `${master.project_no} grew by ${childIds.length} units`, body: `Now ${newUnitCount} unit projects total.`, dedupe_key: `project_split_add:${master.id}:${childIds[0]}` }
      : { kind: 'project_split', title: `${master.project_no} split into ${childIds.length} units`, body: 'Individual unit projects are ready for execution tracking.', dedupe_key: `project_split:${master.id}` };
    await notifyDepartment('Production', note);
    await notifyDepartment('QC', note);
    await notifyDepartment('Dispatch', note);
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, childIds, unitCount: newUnitCount });
}
