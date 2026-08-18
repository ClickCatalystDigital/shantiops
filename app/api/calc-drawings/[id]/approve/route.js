import { NextResponse } from 'next/server';
import { getFreshSessionUser, isCustomer, canAccessProject } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { approveDrawing } from '@/lib/calc';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { syncDesignApprovalMilestone } from '@/lib/milestone-auto';

// Customer-only — approving your own drawing has no internal-user analogue (Design's own sign-off
// is the existing `status` field, PATCHed via app/api/calc-drawings/[id]/route.js).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isCustomer(user)) return NextResponse.json({ error: 'Customer access required' }, { status: 403 });

  const drawing = await queryOne('SELECT * FROM calc_drawings WHERE id = ?', [params.id]);
  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!drawing.customer_visible || !canAccessProject(user, drawing.project_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (drawing.status !== 'under_review') {
    return NextResponse.json({ error: 'Only a drawing under review can be approved' }, { status: 409 });
  }
  if (drawing.customer_approved_at) {
    return NextResponse.json({ error: 'Already approved' }, { status: 409 });
  }

  await approveDrawing(params.id, { approvedBy: user.display_name || user.username });
  await audit('calc_drawing_customer_approved', { actor: user.username, detail: `drawing ${params.id}` });
  await notifyDepartment('Design', {
    kind: 'approval', title: `Customer approved a drawing`, body: drawing.name,
  });
  // design_approval = customer approves the design as a whole — no separate single action for
  // that exists, so it's this per-drawing approval's project-level rollup (lib/milestone-auto.js).
  await syncDesignApprovalMilestone(drawing.project_id, user.username);

  return NextResponse.json({ ok: true });
}
