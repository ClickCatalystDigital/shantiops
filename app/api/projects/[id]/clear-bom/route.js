import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { findBlockedIds, findBlockingReferences } from '@/lib/bom-item-guard';
import { audit } from '@/lib/usb';

// "Delete entire BOM" — wipes every node and item of ONE project in a single all-or-nothing action,
// replacing the old chase-the-tree-bottom-up flow (single-node DELETE refuses a node with children
// and only un-links items, leaving a pile of unassigned lines).
//
// All-or-nothing on purpose: the whole project is pre-flighted and anything protected refuses the
// entire request with a specific reason, so the result is never a half-cleared BOM. Protected =
// released, PR-raised lines (Procurement's requests), any item with downstream activity
// (lib/bom-item-guard.js — the same schema-derived gate single-item DELETE and PMB Replace use),
// and QC records / Form III A groups tied to a node (QC history is kept).
//
// Deliberately left alone: bom_imports (import history), bom_release_snapshots, unit_count,
// structure templates. Junction tables (assembly drawings / calc sheets) ARE cleaned here — the
// single-node DELETE never did, which orphans them (Turso enforces FKs, so it must be explicit).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.bom.clear');
  if (denied) return denied;

  const project = await queryOne('SELECT id, project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const milestone = await queryOne(
    `SELECT status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`,
    [project.id]);
  if (milestone?.actual_end || milestone?.status === 'done') {
    return NextResponse.json({ error: 'This BOM has been released — un-release it before deleting it.' }, { status: 409 });
  }

  const items = await queryAll('SELECT id, material_description, pr_item_id FROM bom_items WHERE project_id = ?', [project.id]);
  const assemblies = await queryAll('SELECT id FROM bom_assemblies WHERE project_id = ?', [project.id]);
  if (!items.length && !assemblies.length) {
    return NextResponse.json({ error: 'This BOM is already empty.' }, { status: 400 });
  }

  const prRaised = items.filter(i => i.pr_item_id != null);
  if (prRaised.length) {
    return NextResponse.json({
      error: `${prRaised.length} line${prRaised.length === 1 ? ' was' : 's were'} raised through Purchase Requests (e.g. "${prRaised[0].material_description}"). `
        + 'Cancel those first — nothing was deleted.',
    }, { status: 409 });
  }

  const itemIds = items.map(i => i.id);
  const blocked = await findBlockedIds(itemIds);
  if (blocked.size) {
    const firstId = [...blocked][0];
    const first = items.find(i => i.id === firstId);
    const { reasons } = await findBlockingReferences(firstId);
    return NextResponse.json({
      error: `${blocked.size} item${blocked.size === 1 ? '' : 's'} can't be deleted because of downstream activity `
        + `(e.g. "${first?.material_description}" ${reasons[0]?.label}). Nothing was deleted.`,
    }, { status: 409 });
  }

  const asmIds = assemblies.map(a => a.id);
  if (asmIds.length) {
    const marks = asmIds.map(() => '?').join(',');
    const qc = await queryOne(`SELECT COUNT(*) AS n FROM qc_records WHERE assembly_id IN (${marks})`, asmIds);
    const groups = await queryOne(`SELECT COUNT(*) AS n FROM qc_iiia_groups WHERE assembly_id IN (${marks})`, asmIds);
    if (qc.n > 0 || groups.n > 0) {
      return NextResponse.json({
        error: 'QC has inspection records or Form III A groups tied to nodes in this BOM — that history is kept. Nothing was deleted.',
      }, { status: 409 });
    }
  }

  try {
    await withTransaction(async tx => {
      if (asmIds.length) {
        const marks = asmIds.map(() => '?').join(',');
        await tx.execute({ sql: `DELETE FROM bom_assembly_drawings WHERE assembly_id IN (${marks})`, args: asmIds });
        await tx.execute({ sql: `DELETE FROM bom_assembly_calc_sheets WHERE assembly_id IN (${marks})`, args: asmIds });
      }
      await tx.execute({ sql: 'DELETE FROM bom_items WHERE project_id = ?', args: [project.id] });
      // One statement, so the parent_id self-FK is checked once at the end, not per row.
      await tx.execute({ sql: 'DELETE FROM bom_assemblies WHERE project_id = ?', args: [project.id] });
    });
  } catch (err) {
    // Pre-flight ran outside the transaction — if something (a PO, a receipt) landed in the gap,
    // Turso's FK enforcement rolls the whole thing back. Report it as a refusal, not a 500.
    if (/FOREIGN KEY/i.test(String(err?.message))) {
      return NextResponse.json({ error: 'Something changed on this BOM while deleting (new downstream activity). Nothing was deleted — please retry.' }, { status: 409 });
    }
    throw err;
  }

  await audit('bom_cleared', {
    actor: user.username,
    detail: JSON.stringify({ project_id: project.id, project_no: project.project_no, items: items.length, nodes: asmIds.length }),
  });
  return NextResponse.json({ ok: true, deletedItems: items.length, deletedNodes: asmIds.length });
}
