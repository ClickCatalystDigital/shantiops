// app/calc/project/[projectId]/[sheetId]/page.js — CALC-CHANGES2.md §A: the actual workspace,
// scoped to one calc sheet. Replaces the old /calc route's direct render.
import { redirect, notFound } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCalcState, getCalcSheet, getCalcDrawings } from '@/lib/calc';
import CalcWorkspace from '@/components/CalcWorkspace';

export const dynamic = 'force-dynamic';

export default async function CalcSheetWorkspace({ params }) {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const sheet = await getCalcSheet(params.sheetId);
  if (!sheet || String(sheet.project_id) !== String(params.projectId)) notFound();

  const [state, drawings] = await Promise.all([getCalcState(params.sheetId), getCalcDrawings(sheet.project_id)]);
  const sheetChain = {
    projectId: sheet.project_id, projectNo: sheet.project_no, customerName: sheet.customer_name, sheetName: sheet.name,
  };

  return <CalcWorkspace initialState={{ ...state, drawings }} sheetId={sheet.id} sheetChain={sheetChain} />;
}
