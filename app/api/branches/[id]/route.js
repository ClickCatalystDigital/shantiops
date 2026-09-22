// app/api/branches/[id]/route.js — rename/toggle active. No DELETE, same deactivate-don't-delete
// convention as sales_stages (a branch may already be referenced from real leads/sale_orders).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.branch.write');
  if (denied) return denied;

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.name !== undefined) { fields.push('name = ?'); args.push(String(b.name).trim()); }
  if (b.region !== undefined) { fields.push('region = ?'); args.push(b.region || null); }
  if (b.active !== undefined) { fields.push('active = ?'); args.push(b.active ? 1 : 0); }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);

  try {
    await execute(`UPDATE branches SET ${fields.join(', ')} WHERE id = ?`, args);
    await audit('branch_edited', { actor: user.username, detail: `branch #${params.id}` });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'A branch with that name already exists' }, { status: 409 });
    }
    throw err;
  }
}
