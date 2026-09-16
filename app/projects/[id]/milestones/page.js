// Project View redesign, Part 5 — the PM-only milestone-editing surface. MilestoneBoard/Card/
// Drawer/Grid are reused entirely unmodified, just relocated off the unified Project View (which
// now only shows Row 1's read-only tracker). Zero API changes — same PATCH /api/milestones/[id],
// same HEAD_EDITABLE/EDITABLE server split (irrelevant here anyway since head is always false for a
// PM, same as the generic milestone route already assumes).
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getProjectDetail } from '@/lib/data';
import { getFreshSessionUser, isPM, roleHome } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import MilestoneBoard from '@/components/MilestoneBoard';
import { ArrowLeftIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ProjectMilestonesPage({ params }) {
  const user = await getFreshSessionUser();
  if (!isPM(user)) redirect(roleHome(user));

  const detail = await getProjectDetail(params.id);
  if (!detail) notFound();
  const { project, milestones } = detail;

  const departmentsWithMilestones = DEPARTMENTS.filter(d => milestones.some(m => m.department === d));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-1">
        <Link href={`/projects/${project.id}`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" /> Back to {project.project_no}
        </Link>
        <h1 className="text-xl font-semibold">Milestones — {project.project_no}</h1>
        <p className="text-sm text-muted-foreground">{project.customer_name}</p>
      </div>

      {departmentsWithMilestones.map(dept => (
        <section key={dept} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{dept}</h2>
          <MilestoneBoard milestones={milestones.filter(m => m.department === dept)} head={false} />
        </section>
      ))}
    </main>
  );
}
