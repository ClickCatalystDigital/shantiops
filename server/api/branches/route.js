// app/api/branches/route.js — Sales CRM expansion Phase 0a. A real, Sales/CRM-scoped Branch
// master (not company-wide — no user-access scoping, no other department touched), used to tag
// Enquiries/Leads and Sale Orders and to drive report grouping. Same GET-open/POST-gated shape as
// app/api/sales-stages/route.js, but requireCrmAction (Sales OR Marketing) rather than PM-only —
// Branch is a shared CRM master, not a PM-only template.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM branches ORDER BY name'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.branch.write');
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  try {
    const { lastId } = await execute(
      'INSERT INTO branches (name, region, created_by) VALUES (?, ?, ?)',
      [name, b.region || null, user.username]
    );
    await audit('branch_created', { actor: user.username, detail: name });
    return NextResponse.json({ id: Number(lastId) });
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'A branch with that name already exists' }, { status: 409 });
    }
    throw err;
  }
}
