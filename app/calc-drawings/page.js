// app/calc-drawings/page.js — Drawings' own top-level nav tab (BOM-FOLLOWUP-NOTES.md §3), split out
// of the Calc Sheets workspace. One page, one searchable project dropdown (DrawingsWorkspace) —
// no separate "pick a project" landing grid or per-project route anymore.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList, getDesignTeamMembers } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import DrawingsWorkspace from '@/components/DrawingsWorkspace';

export const dynamic = 'force-dynamic';

export default async function DrawingsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const [projects, designTeam] = await Promise.all([getActiveProjectsList(), getDesignTeamMembers()]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Drawings" description="Design deliverable checklist, project by project." />
      <DrawingsWorkspace projects={projects} designTeam={designTeam} user={user} />
    </main>
  );
}
