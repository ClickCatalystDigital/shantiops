// app/calc/project/[projectId]/[sheetId]/page.js — CALC-CHANGES2.md §A: the actual workspace,
// scoped to one calc sheet. Replaces the old /calc route's direct render.
import { redirect, notFound } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCalcState, getCalcSheet, getCalcDrawings } from '@/lib/calc';
import { getDesignTeamMembers } from '@/lib/data';
import CalcWorkspace from '@/components/CalcWorkspace';

export const dynamic = 'force-dynamic';

export default async function CalcSheetWorkspace({ params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const sheet = await getCalcSheet(params.sheetId);
  if (!sheet || String(sheet.project_id) !== String(params.projectId)) notFound();

  const [state, drawings, designTeam] = await Promise.all([getCalcState(params.sheetId), getCalcDrawings(sheet.project_id), getDesignTeamMembers()]);
  const sheetChain = {
    sheetId: sheet.id, projectId: sheet.project_id, projectNo: sheet.project_no, customerName: sheet.customer_name, sheetName: sheet.name, csNo: sheet.cs_no,
  };

  return <CalcWorkspace initialState={{ ...state, drawings }} sheetId={sheet.id} sheetChain={sheetChain} user={user} designTeam={designTeam} />;
}
