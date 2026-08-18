import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { ACTION_CATALOG } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// PM-only, same tier as the Access Matrix it sits next to in Settings. One row upserted per
// toggle — action_permissions has no meaningful GET here since app/settings/page.js reads it
// straight off the DB server-side alongside ACTION_CATALOG (same precedent as heads/designTeam).
export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const b = await req.json();
  const { department, action_key: actionKey, requires_head: requiresHead } = b;
  const known = (ACTION_CATALOG[department] || []).some(a => a.key === actionKey);
  if (!known) return NextResponse.json({ error: 'Unknown department or action' }, { status: 400 });

  await execute(
    `INSERT INTO action_permissions (department, action_key, requires_head) VALUES (?, ?, ?)
     ON CONFLICT(department, action_key) DO UPDATE SET requires_head = excluded.requires_head`,
    [department, actionKey, requiresHead ? 1 : 0]
  );
  await audit('action_permission_edit', {
    actor: user.username,
    detail: `${department}: ${actionKey} -> ${requiresHead ? 'Head only' : 'Everyone'}`,
  });
  return NextResponse.json({ ok: true });
}
