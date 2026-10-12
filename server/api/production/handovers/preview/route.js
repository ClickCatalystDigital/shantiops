// What will happen to each project's packing list if these items are handed over — so the screen can
// ask Production only the questions that matter (a packed list: pull it back to draft, or start a new one?).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { describeProjectLists } from '@/lib/packing-generate';
import { validateHandoverItems, groupHandovers } from '@/lib/production-handover';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const b = await req.json();
  const { picked, error } = await validateHandoverItems(b.items);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const groups = [];
  for (const g of groupHandovers(picked)) {
    const d = await describeProjectLists(g.unit ? g.unit.childId : g.projectId);
    groups.push({ key: g.key, project_no: g.no, unit: g.unitNo || null, items: g.ids.length, ...d });
  }
  return NextResponse.json({ groups });
}
