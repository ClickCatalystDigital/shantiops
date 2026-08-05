// app/api/purchase-requisitions/route.js — Group 5 Bundle A (unified PR flow, D3). Eng/Design/
// Stores raise a PR (one or more lines, each split across one or more projects with its own qty) and
// it materializes straight to bom_items — no acceptance gate (client decision: replaces the old
// single-item procurement_requests flow, which is now dead but left in place, same "don't drop"
// precedent as the retired tickets table).
import { NextResponse } from 'next/server';
import { execute, nextCounterValue } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const PR_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];

export async function POST(req) {
  const user = getSessionUser();
  const b = await req.json();

  const raisedByDept = b.raised_by_dept;
  if (!PR_DEPARTMENTS.includes(raisedByDept) || !canAccessDepartment(user, raisedByDept)) {
    return NextResponse.json({ error: 'Pick a department you belong to' }, { status: 403 });
  }

  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return NextResponse.json({ error: 'Add at least one line' }, { status: 400 });
  for (const line of lines) {
    if (!String(line.material_description || '').trim()) {
      return NextResponse.json({ error: 'Every line needs a description' }, { status: 400 });
    }
    const projects = Array.isArray(line.projects) ? line.projects : [];
    if (!projects.length || projects.some(p => !p.project_id || !String(p.qty_text || '').trim())) {
      return NextResponse.json({ error: `"${line.material_description}" needs at least one project + qty` }, { status: 400 });
    }
  }

  const seq = await nextCounterValue('pr_no', 0);
  const prNo = `PR-${seq}`;
  const { lastId: prId } = await execute(
    'INSERT INTO purchase_requisitions (pr_no, raised_by_dept, created_by) VALUES (?, ?, ?)',
    [prNo, raisedByDept, user.username]
  );

  const bomItemIds = [];
  for (const [i, line] of lines.entries()) {
    // pr_items has no separate uom column — like bom_items.qty_text everywhere else in this app,
    // quantity and unit are one free-text field ("4 Nos"), typed per-project below since that's
    // where the real quantity actually lives (a PR line's qty is the sum of its project splits,
    // never entered as one number up front).
    const { lastId: prItemId } = await execute(
      `INSERT INTO pr_items (pr_id, material_description, moc, size_spec, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [Number(prId), line.material_description.trim(), line.moc || null, line.size_spec || null, i]
    );
    for (const p of line.projects) {
      await execute(
        'INSERT INTO pr_item_projects (pr_item_id, project_id, qty_text) VALUES (?, ?, ?)',
        [Number(prItemId), p.project_id, p.qty_text.trim()]
      );
      // Materializes immediately — this line×project pair is the real procurement need, live on
      // Enquiry the moment the PR is submitted (no accept step, per the unify decision).
      const { lastId: bomItemId } = await execute(
        `INSERT INTO bom_items (project_id, material_description, moc, size_spec, qty_text, purchase_status, pr_item_id)
         VALUES (?, ?, ?, ?, ?, 'Enquiry', ?)`,
        [p.project_id, line.material_description.trim(), line.moc || null, line.size_spec || null,
          p.qty_text.trim(), Number(prItemId)]
      );
      bomItemIds.push(Number(bomItemId));
    }
  }

  await audit('pr_raised', {
    actor: user.username,
    detail: `${prNo} (${raisedByDept}): ${lines.length} line(s), ${bomItemIds.length} item(s)`,
  });
  return NextResponse.json({ pr_no: prNo, bom_item_ids: bomItemIds });
}
