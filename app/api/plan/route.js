// Planning -> Material Plan (read-only). Production, Stores and Procurement heads all need the same
// "can we cover this?" answer; the row actions underneath are still gated by their own routes.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getPlan } from '@/lib/plan-coverage';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!['Production', 'Stores', 'Procurement'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const p = new URL(req.url).searchParams.get('project_ids');
  const projectIds = p ? p.split(',').map(Number).filter(Boolean) : null;
  // Stores' Inventory table only needs the per-item pool figures — compute just those, not the whole plan.
  if (new URL(req.url).searchParams.get('summary') === 'items') return NextResponse.json({ items: (await getPlan({ itemsOnly: true })).items });
  const plan = await getPlan({ projectIds });
  return NextResponse.json(plan);
}
