import { NextResponse } from 'next/server';
import { getFreshSessionUser, hasActiveDesignResponsibility } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { requireCalcAccess, updateDrawing, getDrawingFiles, deleteDrawing, isAssignedDesigner, resolveAssignedUserId, findDesignEmployeeByName } from '@/lib/calc';
import { deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';
import { notifyDepartmentHeads, notifyUser } from '@/lib/notify';

const PATCHABLE = { status: 'status', assignedTo: 'assigned_to', dueDate: 'due_date', notes: 'notes', name: 'name', description: 'description', drawingType: 'drawing_type', customerVisible: 'customer_visible' };

// What a Head's own status change means to the assigned Designer — approve/send-back/mark-as-built
// are the only status writes the new UI ever lets a Head make (see components/CalcWorkspace.jsx's
// HeadApprovalControl); anything else reaching this map is a no-op notification-wise.
const HEAD_STATUS_NOTICE = {
  approved: { title: 'Approved', body: 'approved this drawing.' },
  in_progress: { title: 'Sent back', body: 'sent this drawing back for changes.' },
  as_built: { title: 'Marked as built', body: 'marked this drawing as built.' },
};

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const head = await hasActiveDesignResponsibility(user, 'head');
  const designer = await hasActiveDesignResponsibility(user, 'designer');
  if (!head && !designer) return NextResponse.json({ error: 'Design access required' }, { status: 403 });

  const drawing = await queryOne(
    'SELECT status, name, project_id, assigned_to, customer_visible FROM calc_drawings WHERE id = ?',
    [params.id]
  );
  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!head && (b.assignedTo !== undefined || b.dueDate !== undefined || b.customerVisible !== undefined)) {
    return NextResponse.json({ error: 'Only the Design Head can assign work, set due dates, or share a drawing with the customer' }, { status: 403 });
  }
  // Everything else a non-Head can write (status, title/type/description/notes) is scoped to
  // whoever this drawing is actually assigned to — matches the UI, which only shows these as
  // editable to that same person (or the Head). One lookup, reused below.
  const assignedToMe = head ? true : await isAssignedDesigner(user, drawing.assigned_to);
  if (!head && b.status !== undefined) {
    if (!['not_started', 'in_progress', 'under_review'].includes(b.status)) {
      return NextResponse.json({ error: 'Designers can submit work for review but cannot approve it' }, { status: 403 });
    }
    if (!assignedToMe) return NextResponse.json({ error: 'Only the designer this drawing is assigned to can submit it' }, { status: 403 });
  }
  if (!head && !assignedToMe && (b.name !== undefined || b.description !== undefined || b.drawingType !== undefined || b.notes !== undefined)) {
    return NextResponse.json({ error: 'Only the designer this drawing is assigned to can edit its details' }, { status: 403 });
  }
  // A drawing needs at least one file before it means anything to review — the file-upload
  // control's own "mandatory to submit" rule, re-checked here so it can't be skipped by calling
  // the API directly.
  if (b.status === 'under_review') {
    const fileCount = await queryOne('SELECT COUNT(*) AS n FROM calc_drawing_files WHERE drawing_id = ?', [params.id]);
    if (!fileCount?.n) return NextResponse.json({ error: 'Upload a file before submitting for review' }, { status: 400 });
  }
  if (b.assignedTo !== undefined && b.assignedTo) {
    const employee = await findDesignEmployeeByName(String(b.assignedTo));
    if (!employee) return NextResponse.json({ error: 'Assigned person must be an active Design employee' }, { status: 400 });
  }
  const fields = {};
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (b[key] !== undefined && key !== 'customerVisible') fields[column] = b[key];
  }
  // Attribution for a genuine new approval — "Approved by {name}" on screen needs a name to show.
  // Never re-stamped on a later as_built<->approved move; that's the same approval, not a new one.
  if (b.status === 'approved' && !['approved', 'as_built'].includes(drawing.status)) {
    fields.approved_by = user.display_name || user.username;
    fields.approved_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  if (b.customerVisible !== undefined) {
    const next = b.customerVisible ? 1 : 0;
    fields.customer_visible = next;
    // Only a genuine 0->1 flip starts the 5-minute notification clock; a genuine 1->0 flip clears
    // it. Re-PATCHing the same value again (no real transition) leaves the clock untouched, so a
    // flip-and-flip-back inside the window (an accidental toggle) never reaches the sweep at all.
    if (next === 1 && !drawing.customer_visible) {
      fields.customer_visible_since = new Date().toISOString().slice(0, 19).replace('T', ' ');
      fields.customer_notified_at = null;
    } else if (next === 0 && drawing.customer_visible) {
      fields.customer_visible_since = null;
      fields.customer_notified_at = null;
    }
  }
  if (!Object.keys(fields).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  await updateDrawing(params.id, fields);
  await audit('calc_drawing_edit', { actor: user.username, detail: `drawing ${params.id}` });

  // A real status transition -> notify whoever needs to know. Two directions, never both: a
  // Designer submitting pages the Head (existing behavior); a Head approving/sending
  // back/marking as built pages the assigned Designer (new — "whatever the Head does, it notifies
  // the member assigned to it").
  if (b.status !== undefined && drawing.status !== b.status) {
    if (!head && b.status === 'under_review') {
      await notifyDepartmentHeads('Design', {
        kind: 'drawing_submitted', title: `${drawing.name || 'A drawing'} submitted for review`,
        body: `${user.display_name || user.username} submitted this drawing for review.`,
        project_id: drawing.project_id,
        dedupe_key: `drawing_submitted:${params.id}:${Date.now()}`,
      });
    } else if (head && drawing.assigned_to) {
      const notice = HEAD_STATUS_NOTICE[b.status];
      const assignedUserId = notice ? await resolveAssignedUserId(drawing.assigned_to) : null;
      if (assignedUserId && assignedUserId !== user.id) {
        await notifyUser(assignedUserId, {
          kind: 'drawing_status', title: `${drawing.name || 'A drawing'} — ${notice.title}`,
          body: `${user.display_name || user.username} ${notice.body}`,
          project_id: drawing.project_id,
          dedupe_key: `drawing_status:${params.id}:${b.status}:${Date.now()}`,
        });
      }
    }
  }
  // Explicit "Save" from the Head's own metadata edits (title/type/assignee/due date/description/
  // notes) — separate from the status transitions above, since those already have their own
  // notification and this can fire with no status change at all. Notify whoever the drawing is
  // assigned to *after* this save (a reassignment in the same request pages the new person, not
  // the old one).
  if (b.notify === true && head) {
    const target = fields.assigned_to !== undefined ? fields.assigned_to : drawing.assigned_to;
    const assignedUserId = target ? await resolveAssignedUserId(target) : null;
    if (assignedUserId && assignedUserId !== user.id) {
      await notifyUser(assignedUserId, {
        kind: 'drawing_status', title: `${fields.name || drawing.name || 'A drawing'} — Updated`,
        body: `${user.display_name || user.username} updated this drawing's details.`,
        project_id: drawing.project_id,
        dedupe_key: `drawing_updated:${params.id}:${Date.now()}`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

// Cascade: delete every file row + its R2 object (best-effort — R2 env isn't set in dev, same
// try/catch precedent as test-certificates' PDF routes) before dropping the drawing itself.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  if (!(await hasActiveDesignResponsibility(user, 'head'))) return NextResponse.json({ error: 'Only the Design Head can delete drawings' }, { status: 403 });

  const files = await getDrawingFiles(params.id);
  for (const f of files) {
    try {
      await deleteObject(f.file_key);
    } catch (e) {
      // R2 not configured or object already gone — the DB row below is still the source of truth.
    }
  }
  await deleteDrawing(params.id);
  await audit('calc_drawing_deleted', { actor: user.username, detail: `drawing ${params.id}` });
  return NextResponse.json({ ok: true });
}
