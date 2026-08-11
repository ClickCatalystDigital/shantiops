import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcState, addTemplate } from '@/lib/calc';
import { audit } from '@/lib/usb';

// Snapshots the CURRENT registry's input/constant values under a new template name — same "save
// what's on screen right now" shape as saveSnapshot, just for reusable starting scenarios instead
// of an audit record.
export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!b.sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });

  const { variables } = await getCalcState(b.sheetId);
  const values = {};
  variables.forEach((v) => { if (v.type !== 'computed' && v.type !== 'array') values[v.name] = v.value; });

  const id = await addTemplate({ name, description: b.description || '', values });
  await audit('calc_template_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
