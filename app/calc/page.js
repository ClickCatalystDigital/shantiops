// app/calc/page.js — CALC-CHANGES2.md §A: Calc Sheets' entry point is now a project picker, not the
// workspace directly. Reuses the real `projects` list (getActiveProjectsList, already used by the
// Procurement sourcing picker) instead of inventing a second one.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function CalcProjectPicker() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const projects = await getActiveProjectsList();

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Calc Sheets" description="Pick a project to open its calculation sheets" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/calc/project/${p.id}`}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1 py-4">
                <span className="font-semibold text-primary">{p.project_no}</span>
                <span className="text-sm text-muted-foreground">{p.customer_name}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {projects.length === 0 && <p className="text-sm text-muted-foreground">No active projects yet.</p>}
      </div>
    </main>
  );
}
