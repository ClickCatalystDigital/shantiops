// Accept one or more Procurement cancel-requests in one action (the Manage tab's "select all" —
// see components/ProcurementQueue.jsx): each task is marked done and its linked BOM item's
// purchase_status flips to CANCELLED. Procurement-only — this is Procurement acting on its own
// purchase_status field, same authority the inline BOM status dropdown already gives them.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, isInternal, isHead, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isHead(user) && !canAccessDepartment(user, 'Procurement')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const ids = Array.isArray(b.task_ids) ? b.task_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ error: 'No requests selected' }, { status: 400 });

  const placeholders = ids.map(() => '?').join(',');
  const tasks = await queryAll(
    `SELECT id, bom_item_id, title FROM tasks
      WHERE id IN (${placeholders}) AND department = 'Procurement' AND status = 'open' AND bom_item_id IS NOT NULL`,
    ids
  );

  for (const t of tasks) {
    await execute('UPDATE tasks SET status = ? WHERE id = ?', ['done', t.id]);
    await execute('UPDATE bom_items SET purchase_status = ? WHERE id = ?', ['CANCELLED', t.bom_item_id]);
    await audit('bom_item_cancelled', { actor: user.username, detail: `task ${t.id} (${t.title}): item ${t.bom_item_id}` });
  }

  return NextResponse.json({ ok: true, count: tasks.length });
}
