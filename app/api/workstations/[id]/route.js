// Capacity settings for one workstation (shifts/day, hours/shift, working days/week).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const FIELDS = { shifts_per_day: [0.5, 3], hours_per_shift: [1, 12], working_days_per_week: [1, 7] };

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.settings.write');
  if (actionDenied) return actionDenied;
  const ws = await queryOne('SELECT id, name FROM workstations WHERE id = ?', [params.id]);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const sets = [], args = [];
  for (const [k, [lo, hi]] of Object.entries(FIELDS)) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!(v >= lo && v <= hi)) return NextResponse.json({ error: `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}` }, { status: 400 });
    sets.push(`${k} = ?`); args.push(v);
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await execute(`UPDATE workstations SET ${sets.join(', ')} WHERE id = ?`, [...args, ws.id]);
  await audit('workstation_capacity', { actor: user.username, detail: `${ws.name}: ${sets.join(', ')} -> ${args.join(', ')}` });
  return NextResponse.json({ ok: true });
}
