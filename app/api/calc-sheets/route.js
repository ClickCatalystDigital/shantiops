import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcSheets, createCalcSheet } from '@/lib/calc';
import { audit } from '@/lib/usb';

// CALC-CHANGES2.md §A — the calc-sheet selector tabs under /calc/project/[projectId] list/create
// against this route.
export async function GET(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const sheets = await getCalcSheets(projectId);
  return NextResponse.json({ sheets });
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!b.projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  const id = await createCalcSheet(b.projectId, name, user.username);
  await audit('calc_sheet_created', { actor: user.username, detail: `${name} (project ${b.projectId})` });
  return NextResponse.json({ id });
}
