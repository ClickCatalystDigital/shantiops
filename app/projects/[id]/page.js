import { notFound, redirect } from 'next/navigation';
import { getProjectDetail, getProjectBom, getProjectPackingLists, getBomRollup, getQcRecords, getProjectTasks } from '@/lib/data';
import { getSessionUser, isCustomer, isPM, isHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import { editableBomFields } from '@/lib/bom-fields.mjs';
import ProjectHeader from '@/components/ProjectHeader';
import TodayBand from '@/components/TodayBand';
import PortfolioDelayTimeline from '@/components/PortfolioDelayTimeline';
import DepartmentPanel from '@/components/DepartmentPanel';
import ProjectDepartmentTabs from '@/components/ProjectDepartmentTabs';
import BomProgress from '@/components/BomProgress';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }) {
  const user = getSessionUser();
  if (isCustomer(user)) redirect(roleHome(user)); // customers use the portal, not the ops view

  const data = await getProjectDetail(params.id);
  if (!data) notFound();
  const { project, milestones, health, blocker } = data;
  const { bom, pending, imports } = await getProjectBom(params.id);
  const packingLists = await getProjectPackingLists(params.id);
  const bomRollup = await getBomRollup(params.id);
  const qcRecords = await getQcRecords(params.id);
  const tasks = await getProjectTasks(project.id);

  const pm = isPM(user);
  const head = isHead(user);
  const myDepts = headDepartments(user);

  // Needs-attention is scoped to what this user acts on: a head sees only their department(s).
  const attentionMilestones = head ? milestones.filter(m => myDepts.includes(m.department)) : milestones;

  // Shared data every DepartmentPanel/tab needs.
  const panelData = {
    milestones, head, projectId: project.id, bom, pending, packingLists,
    canUploadBom: canAccessDepartment(user, 'Engineering'),
    canPack: canAccessDepartment(user, 'Dispatch'),
    bomFields: editableBomFields(user), // field-level BOM edit scope (enforced again in the API)
    bomImports: imports,
    qcRecords, canEditQc: canAccessDepartment(user, 'QC'),
    // One query for all 8 tabs — DepartmentPanel filters client-side, same as it already does for
    // milestones. A head only ever sees their own department's panel, and a PM's canAccessDepartment
    // is unconditionally true for every department, so a single flag matches the real permission
    // surface (no per-department map needed).
    tasks, canRaiseTickets: pm || head,
  };

  return (
    <main className="container flex flex-col gap-6 py-8">
      {/* Row 1: identity/why-delayed beside Needs Attention — mirrors the Executive page's
          Top Risks / Delayed Because layout. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ProjectHeader project={project} health={health} blocker={blocker} />
        <TodayBand milestones={attentionMilestones} />
      </div>

      {/* Row 2: same Milestone Tracker as the Executive dashboard, scoped to this one project —
          shown to every internal role (heads get the full chain as read-only context). Full width
          since the stage bar needs the room. */}
      <PortfolioDelayTimeline projects={[{ ...project, milestones }]} />

      {/* Master BOM procurement rollup — context for every internal role; renders nothing if no BOM. */}
      <BomProgress rollup={bomRollup} />

      {pm ? (
        // PM/admin: the all-departments tabbed card.
        <ProjectDepartmentTabs departments={DEPARTMENTS} {...panelData} />
      ) : (
        // Functional head: their own department(s), stacked.
        myDepts.map(d => (
          <section key={d} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{d}</h2>
            <DepartmentPanel department={d} {...panelData} />
          </section>
        ))
      )}
    </main>
  );
}
