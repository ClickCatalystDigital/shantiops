// Production -> Dispatch handover. GET = lines to hand over + history; POST = hand over finished
// quantities (one record per line/unit). Quantity is checked against what is still left, re-derived
// here — never trusted from the client. Every handover must say whether Production approves the items
// for dispatch (mandatory); Yes pre-fills Production's slot of the pre-dispatch review. If the project's
// last list is already packed, the caller says whether to pull it back to draft or start a new one.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { autoPackHandedOver } from '@/lib/packing-generate';
import { getHandoverLines, getHandoverHistory, getWaitingMadeCounts, syncProductionDone, validateHandoverItems, groupHandovers } from '@/lib/production-handover';
import { tabLink } from '@/lib/alert-links.mjs';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const [lines, history] = await Promise.all([getHandoverLines(), getHandoverHistory()]);
  return NextResponse.json({ lines, history, waiting: await getWaitingMadeCounts(lines) });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const b = await req.json();
  if (typeof b.approve !== 'boolean') return NextResponse.json({ error: 'Say whether you approve these items for dispatch' }, { status: 400 });
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  const { picked, error } = await validateHandoverItems(b.items);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const choices = b.list_choices && typeof b.list_choices === 'object' ? b.list_choices : {};

  await withTransaction(async tx => {
    for (const { line, qty } of picked) {
      await tx.execute({
        sql: `INSERT INTO production_handovers (bom_item_id, child_project_id, qty, note, handed_by, production_approved, approved_by, approved_at)
              VALUES (?,?,?,?,?,?,?,${b.approve ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
        args: [line.bom_item_id, line.unit_project_id || null, qty, note, user.username, b.approve ? 1 : 0, b.approve ? user.username : null],
      });
    }
  });
  for (const { line } of picked) if (!line.unit_project_id) await syncProductionDone(line.bom_item_id, line.required_qty);

  // Put what was just handed over on the project's open packing list (or start one). Best-effort:
  // the handover stands even if this fails; Dispatch can still add the items from Pending Items.
  // A packed list is only pulled back to draft when Production said so; otherwise a new draft starts.
  const packing = [];
  for (const g of groupHandovers(picked)) {
    const choice = choices[g.key];
    try {
      const r = await autoPackHandedOver({ projectId: g.projectId, bomItemIds: g.ids, user, unit: g.unit, reopenListId: Number.isInteger(choice) ? choice : null });
      packing.push({ project_no: g.no, unit: g.unitNo || null, ...r });
    } catch (err) { packing.push({ project_no: g.no, unit: g.unitNo || null, error: err.message, added: 0 }); }
  }

  // One alert per project, not per line.
  const perProject = new Map();
  picked.forEach(({ line }) => perProject.set(line.indent_project_id, line.indent_project_no));
  for (const [projectId, no] of perProject) {
    const n = picked.filter(p => p.line.indent_project_id === projectId).length;
    const lists = [...new Set(packing.filter(p => p.project_no === no && p.packing_no).map(p => p.packing_no))];
    const reopened = [...new Set(packing.filter(p => p.project_no === no && p.reopened).map(p => p.packing_no))];
    try {
      await notifyDepartment('Dispatch', {
        kind: 'packing_ready', project_id: projectId,
        link: lists.length === 1 && packing.find(p => p.packing_no === lists[0])?.list_id
          ? `/packing/${packing.find(p => p.packing_no === lists[0]).list_id}` : tabLink('/dispatch', 'pending', { q: no }),
        title: `Ready to pack - ${no}`,
        body: `Production handed over ${n} item${n === 1 ? '' : 's'}${b.approve ? ' and approved them for dispatch' : ''}.${lists.length ? ` Added to packing list ${lists.join(', ')}.` : ' They are ready for a packing list.'}${reopened.length ? ` ${reopened.join(', ')} was already packed and has been pulled back to draft. Pack it again and resubmit it for review.` : ''}`,
      }, { except: user.id });
    } catch { /* best-effort */ }
  }
  await audit('production_handover', {
    actor: user.username,
    detail: JSON.stringify({ approved: b.approve, items: picked.map(p => ({ bom_item_id: p.line.bom_item_id, unit: p.line.unit_project_id || null, qty: p.qty })) }),
  });
  return NextResponse.json({ ok: true, count: picked.length, packing });
}
