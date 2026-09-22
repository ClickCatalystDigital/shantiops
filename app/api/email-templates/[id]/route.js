// app/api/email-templates/[id]/route.js — edit/deactivate. No DELETE — a quotation may already
// point at this template via email_template_id, and that link must stay resolvable.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

const EDITABLE = ['name', 'subject', 'body', 'regards', 'active'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of EDITABLE) {
    if (b[key] === undefined) continue;
    fields.push(`${key} = ?`);
    args.push(key === 'active' ? (b[key] ? 1 : 0) : b[key]);
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE email_templates SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('email_template_edited', { actor: user.username, detail: `template #${params.id}` });
  return NextResponse.json({ ok: true });
}
