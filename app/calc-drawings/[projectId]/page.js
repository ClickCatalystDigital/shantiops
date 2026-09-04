// app/calc-drawings/[projectId]/page.js — the actual drawing checklist, reusing CalcWorkspace's own
// DrawingsPanel component directly rather than duplicating its markup/mutation logic.
import { redirect, notFound } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCalcDrawings } from '@/lib/calc';
import { getDesignTeamMembers } from '@/lib/data';
import { queryOne } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import DrawingsProjectView from '@/components/DrawingsProjectView';

export const dynamic = 'force-dynamic';

export default async function DrawingsForProject({ params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const project = await queryOne('SELECT id, project_no, customer_name FROM projects WHERE id = ?', [params.projectId]);
  if (!project) notFound();
  const [drawings, designTeam] = await Promise.all([getCalcDrawings(project.id), getDesignTeamMembers()]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title={`${project.project_no} — Drawings`} description={project.customer_name} />
      <DrawingsProjectView drawings={drawings} projectId={project.id} user={user} designTeam={designTeam} />
    </main>
  );
}
