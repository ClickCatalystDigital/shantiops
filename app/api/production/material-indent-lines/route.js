// Material Indent bridge — Production's own cross-project worklist: every BOM line Stores has
// routed to Production and is ready to indent. Read-only; the actual "create the indent" action
// still goes through the existing, unmodified POST /api/material-indents.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getPendingProductionMaterialLines } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  return NextResponse.json(await getPendingProductionMaterialLines());
}
