import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { MILESTONE_AUTOMATION_CATALOG } from '@/lib/milestone-auto';
import { audit } from '@/lib/usb';

// PM-only, same tier and shape as app/api/action-permissions/route.js — Settings reads the current
// rows straight off the DB server-side alongside the catalog, no meaningful GET needed here.
export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const b = await req.json();
  const { milestone_key: milestoneKey, auto_start: autoStart, auto_complete: autoComplete } = b;
  const known = MILESTONE_AUTOMATION_CATALOG.some(m => m.key === milestoneKey);
  if (!known) return NextResponse.json({ error: 'Unknown milestone key' }, { status: 400 });

  await execute(
    `INSERT INTO milestone_automation (milestone_key, auto_start, auto_complete) VALUES (?, ?, ?)
     ON CONFLICT(milestone_key) DO UPDATE SET auto_start = excluded.auto_start, auto_complete = excluded.auto_complete`,
    [milestoneKey, autoStart ? 1 : 0, autoComplete ? 1 : 0]
  );
  await audit('milestone_automation_edit', {
    actor: user.username,
    detail: `${milestoneKey}: auto-start ${autoStart ? 'on' : 'off'}, auto-complete ${autoComplete ? 'on' : 'off'}`,
  });
  return NextResponse.json({ ok: true });
}
