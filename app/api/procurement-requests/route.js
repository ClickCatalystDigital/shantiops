// Create a new-item procurement request (PROCUREMENT-CHANGES.md §4.0) — the "Request procurement"
// kind on the cross-department Raise dialog (components/TicketsPanel.jsx). Not a bom_items row yet:
// it only materializes into one once Procurement accepts it in the Requests tab (see [id]/route.js).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  // Same caller-intent boundary as POST /api/production/tasks: the raiser names their own
  // department, validated against what they're actually granted rather than re-derived.
  if (!b.from_department || !canAccessDepartment(user, b.from_department)) {
    return NextResponse.json({ error: 'Not your department' }, { status: 403 });
  }
  const materialDescription = String(b.material_description || '').trim();
  if (!materialDescription) return NextResponse.json({ error: 'Item description is required' }, { status: 400 });

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [Number(b.project_id)]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { lastId } = await execute(
    `INSERT INTO procurement_requests
       (project_id, from_department, material_description, moc, size_spec, qty_text, pr_ref, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, b.from_department, materialDescription, b.moc || null, b.size_spec || null,
      b.qty_text || null, b.pr_ref || null, b.notes || null, user.username]
  );
  const id = Number(lastId);
  await audit('procurement_request_raised', {
    actor: user.username, detail: `${b.from_department}: ${materialDescription} (project ${project.id})`,
  });
  // Same signal-only precedent as a cross-department task raise (§3b) — no work object here yet,
  // the request itself doesn't become one until accepted. actionKey narrows this to Procurement
  // Heads if procurement.request.decide (the PATCH .../[id] route that resolves it) is configured
  // Head-only — a Member who can't accept/reject it doesn't need the chime.
  await notifyDepartment('Procurement', {
    kind: 'request', title: `New procurement request from ${b.from_department}`, body: materialDescription,
  }, { except: user.id, actionKey: 'procurement.request.decide' });
  return NextResponse.json({ id });
}
