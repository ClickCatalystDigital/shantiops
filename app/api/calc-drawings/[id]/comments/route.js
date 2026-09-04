import { NextResponse } from 'next/server';
import { getFreshSessionUser, isCustomer, canAccessProject, hasActiveDesignResponsibility } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { getDrawingComments, addDrawingComment, requireCalcAccess } from '@/lib/calc';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';

// Either an internal Design/Engineering user (requireCalcAccess) or the owning project's customer
// can read/post — a drawing comment thread is the one place those two audiences meet.
//
// On a customer_visible drawing, the internal side is narrowed to the Design Head only — the same
// authority tier that already gates the customer_visible toggle itself (PATCH .../route.js). Before
// this, any Design/Engineering member could read/post directly into a thread the customer is in,
// with no approval-equivalent gate at all. A non-customer-visible thread is untouched — plain
// department-wide access, same as before.
async function authorize(req, drawingId) {
  const user = await getFreshSessionUser();
  const drawing = await queryOne('SELECT project_id, customer_visible FROM calc_drawings WHERE id = ?', [drawingId]);
  if (!drawing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  if (isCustomer(user)) {
    if (!drawing.customer_visible || !canAccessProject(user, drawing.project_id)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    return { user, drawing, authorType: 'customer' };
  }
  const denied = requireCalcAccess(user);
  if (denied) return { error: denied };
  if (drawing.customer_visible && !(await hasActiveDesignResponsibility(user, 'head'))) {
    return { error: NextResponse.json({ error: 'Only the Design Head can read or post in a customer-visible drawing thread' }, { status: 403 }) };
  }
  return { user, drawing, authorType: 'internal' };
}

export async function GET(req, { params }) {
  const { error } = await authorize(req, params.id);
  if (error) return error;
  const comments = await getDrawingComments(params.id);
  return NextResponse.json(comments);
}

export async function POST(req, { params }) {
  const { error, user, drawing, authorType } = await authorize(req, params.id);
  if (error) return error;

  const b = await req.json().catch(() => ({}));
  const body = (b.body || '').trim();
  if (!body) return NextResponse.json({ error: 'Comment body is required' }, { status: 400 });

  await addDrawingComment({
    drawingId: params.id, authorType, authorName: user.display_name || user.username, authorUsername: user.username, body,
  });
  await audit('calc_drawing_comment', { actor: user.username, detail: `drawing ${params.id}` });

  // Cross-audience signal: an internal comment doesn't need to page anyone new (Design already
  // watches its own Drawings panel); a customer comment should reach Design the same way any other
  // cross-department signal does.
  if (authorType === 'customer') {
    await notifyDepartment('Design', {
      kind: 'comment', title: `Customer commented on a drawing`, body,
    });
  }

  return NextResponse.json({ ok: true });
}
