// app/calc/page.js — Calc Sheets landing page: every calculation sheet as a card, filtered by a searchable
// project picker and a sheet-name search (?project= preselects a project). Sheets open in the workspace.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList } from '@/lib/data';
import { getAllCalcSheets } from '@/lib/calc';
import CalcSheetsBrowser from '@/components/CalcSheetsBrowser';

export const dynamic = 'force-dynamic';

export default async function CalcSheetsPage(props) {
  const searchParams = await props.searchParams;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const [projects, sheets] = await Promise.all([getActiveProjectsList(), getAllCalcSheets()]);
  // A sheet on a project that is no longer active still needs its project in the picker.
  const byId = new Map(projects.map((p) => [p.id, { id: p.id, project_no: p.project_no, customer_name: p.customer_name }]));
  for (const s of sheets) if (!byId.has(s.project_id)) byId.set(s.project_id, { id: s.project_id, project_no: s.project_no, customer_name: s.customer_name });

  return (
    <main className="container py-8">
      <CalcSheetsBrowser
        projects={[...byId.values()]}
        sheets={sheets.map((s) => ({ ...s }))}
        initialProjectId={Number(searchParams?.project) || null}
      />
    </main>
  );
}
