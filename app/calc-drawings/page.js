// app/calc-drawings/page.js — Drawings' own top-level nav tab (BOM-FOLLOWUP-NOTES.md §3), split out
// of the Calc Sheets workspace. One page, one searchable project dropdown (DrawingsWorkspace) —
// no separate "pick a project" landing grid or per-project route anymore.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getActiveProjectsList, getDesignTeamMembers } from '@/lib/data';
import { queryAll } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import DrawingsWorkspace from '@/components/DrawingsWorkspace';

export const dynamic = 'force-dynamic';

export default async function DrawingsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) redirect(roleHome(user));

  const [projects, designTeam, counts] = await Promise.all([
    getActiveProjectsList(), getDesignTeamMembers(),
    // Per-project drawing counts for the project list shown before one is picked.
    queryAll(`SELECT project_id, COUNT(*) AS total,
                     SUM(status IN ('approved', 'as_built')) AS approved, SUM(customer_visible = 1) AS shared
                FROM calc_drawings GROUP BY project_id`),
  ]);
  const drawingCounts = Object.fromEntries(counts.map(c => [c.project_id, { total: Number(c.total), approved: Number(c.approved) || 0, shared: Number(c.shared) || 0 }]));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Drawings" description="Design deliverable checklist, project by project." />
      <DrawingsWorkspace projects={projects} designTeam={designTeam} user={user} drawingCounts={drawingCounts} />
    </main>
  );
}
