import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { getSubsystemCheck } from '@/lib/subsystem-check';
import { audit } from '@/lib/usb';

// "Possibly missing" lines for a project's subsystems (informational — never blocks Release).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  return NextResponse.json(await getSubsystemCheck(Number(params.id)));
}

// "Not needed here": remember, on that node, that a build line is deliberately absent so it stops being listed.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.assembly.add');
  if (denied) return denied;
  const b = await req.json();
  const key = String(b.key || '').trim();
  const node = await queryOne('SELECT id, name, check_dismissed_json FROM bom_assemblies WHERE id = ? AND project_id = ?', [b.node_id, params.id]);
  if (!node || !key) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let list = [];
  try { list = JSON.parse(node.check_dismissed_json || '[]'); } catch { /* start fresh */ }
  if (!list.includes(key)) list.push(key);
  await execute('UPDATE bom_assemblies SET check_dismissed_json = ? WHERE id = ?', [JSON.stringify(list), node.id]);
  await audit('subsystem_check_dismissed', { actor: user.username, detail: `project ${params.id}, node "${node.name}": ${key}` });
  return NextResponse.json({ ok: true });
}
