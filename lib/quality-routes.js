// Shared permission checks for the quality registers (docs/gulf-coast-asme-plan.md, Phase 1).
import { NextResponse } from 'next/server';
import { canAccessDepartment, requireDepartment } from './auth';
import { requireAction } from './action-permissions';

export const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });
export const err = (m, status = 400) => NextResponse.json({ error: m }, { status });
export const canRead = u => canAccessDepartment(u, 'QC') || canAccessDepartment(u, 'Production');
export const qcOnly = async (u, key) => requireDepartment(u, 'QC') || (await requireAction(u, 'QC', key));
// Welds may be entered by QC or by Production (the shop knows which welder did which joint).
export async function canWriteWelds(u) {
  if (canAccessDepartment(u, 'QC')) return requireAction(u, 'QC', 'qc.weld.write');
  if (canAccessDepartment(u, 'Production')) return requireAction(u, 'Production', 'production.weld.write');
  return forbidden();
}
