// Delete a route template. Hard delete, always — unlike bom_structure_templates, nothing else ever
// references a route template row once applied (apply-route-template copies its items into a fresh,
// independent work_order_operations set, same "frozen copy" precedent), so there's no "archive if
// used" case to guard against.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.settings.write');
  if (actionDenied) return actionDenied;

  await execute('DELETE FROM work_order_route_templates WHERE id = ?', [params.id]);
  await audit('work_order_route_template_deleted', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
