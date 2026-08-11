// app/calc/project/[projectId]/page.js — CALC-CHANGES2.md §A: the calc-sheet selector, sitting
// between the project picker and the workspace. Lists this project's calc_sheets (tabs, per the
// brief) + "New Calculation Sheet".
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCalcSheets } from '@/lib/calc';
import { queryOne } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import NewCalcSheetForm from '@/components/NewCalcSheetForm';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function CalcSheetSelector({ params }) {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const project = await queryOne('SELECT id, project_no, customer_name FROM projects WHERE id = ?', [params.projectId]);
  if (!project) notFound();
  const sheets = await getCalcSheets(params.projectId);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title={`${project.project_no} — Calc Sheets`} description={project.customer_name}>
        <NewCalcSheetForm projectId={project.id} />
      </PageHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sheets.map((s) => (
          <Link key={s.id} href={`/calc/project/${project.id}/${s.id}`}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1 py-4">
                <span className="font-semibold text-primary">{s.name}</span>
                <span className="text-xs text-muted-foreground">Created {s.created_at}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {sheets.length === 0 && <p className="text-sm text-muted-foreground">No calculation sheets on this project yet.</p>}
      </div>
    </main>
  );
}
