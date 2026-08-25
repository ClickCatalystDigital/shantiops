// app/projects/[id]/page.js

import { notFound, redirect } from 'next/navigation';
import { getProjectDetail, getProjectBom, getProjectPackingLists, getQcRecords, getQcDocuments, getQcProjectSummary, getProjectTasks, getProjectStages, getStageTemplates, getProjectDesignSummary, getScopeOfSupply, activeDepartmentStatus, getBomAssembliesFlat, getJobWorkInspections, getWorkOrders } from '@/lib/data';
import { getFreshSessionUser, isCustomer, isPM, isHead, isDesignHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { DEPARTMENTS } from '@/lib/milestones';
import { editableBomFields } from '@/lib/bom-fields.mjs';
import ProjectHeader from '@/components/ProjectHeader';
import TodayBand from '@/components/TodayBand';
import PortfolioDelayTimeline from '@/components/PortfolioDelayTimeline';
import DepartmentPanel from '@/components/DepartmentPanel';
import ProjectDepartmentTabs from '@/components/ProjectDepartmentTabs';
import { DepartmentPills, DepartmentProgress } from '@/components/DepartmentStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user)) redirect(roleHome(user)); // customers use the portal, not the ops view

  const data = await getProjectDetail(params.id);
  if (!data) notFound();
  const { project, milestones, health, blocker } = data;
  const { bom, pending, imports } = await getProjectBom(params.id);
  const bomAssemblies = await getBomAssembliesFlat(params.id); // STERP item 16, §5o — assign-to-assembly picker
  const packingLists = await getProjectPackingLists(params.id);
  const qcRecords = await getQcRecords(params.id);
  const qcDocuments = await getQcDocuments(params.id);
  const qcSummary = await getQcProjectSummary(params.id);
  const jobWorkInspections = await getJobWorkInspections(params.id); // STERP item 33, §5p
  const workOrders = await getWorkOrders({ projectId: params.id }); // STERP item 31's dispatch-eligibility link, §5p
  const tasks = await getProjectTasks(project.id);
  const stages = await getProjectStages(project.id);
  const { templates: stageTemplates, items: stageTemplateItems } = await getStageTemplates();
  const designSummary = await getProjectDesignSummary(project.id);
  const scopeOfSupply = await getScopeOfSupply(project.id);
  // Row 2 slot 3 — which department(s) currently have the ball, and what they're actually doing,
  // same departmentProgress shape the Projects list uses (lib/data.js's activeDepartmentStatus,
  // shared with getProjectsWithStatus), just scoped to this one project's own milestones instead of
  // recomputed from a fresh query. Replaces the old Design-chip-or-BOM-rollup guess, which showed
  // Design's own progress (or a BOM rollup once Procurement had the BOM) regardless of which
  // department actually held the project at the time.
  const { departmentProgress } = activeDepartmentStatus(milestones);

  const pm = isPM(user);
  const head = isHead(user);
  const myDepts = headDepartments(user);

  // Needs-attention is scoped to what this user acts on: a head sees only their department(s).
  const attentionMilestones = head ? milestones.filter(m => myDepts.includes(m.department)) : milestones;

  // Shared data every DepartmentPanel/tab needs.
  const panelData = {
    milestones, head, projectId: project.id, bom, pending, packingLists, bomAssemblies,
    canUploadBom: canAccessDepartment(user, 'Engineering') || canAccessDepartment(user, 'Design'),
    canPack: canAccessDepartment(user, 'Dispatch'),
    bomFields: editableBomFields(user), // field-level BOM edit scope (enforced again in the API)
    bomImports: imports,
    qcRecords, qcDocuments, qcSummary, canEditQc: canAccessDepartment(user, 'QC'),
    jobWorkInspections, workOrders,
    canEditProductionQc: canAccessDepartment(user, 'Production'),
    // One query for all 8 tabs — DepartmentPanel filters client-side, same as it already does for
    // milestones. A head only ever sees their own department's panel, and a PM's canAccessDepartment
    // is unconditionally true for every department, so a single flag matches the real permission
    // surface (no per-department map needed).
    tasks, canRaiseTickets: pm || head,
    stages, stageTemplates, stageTemplateItems, canManageStages: pm || head,
    designSummary,
    scopeOfSupply, canEditScope: canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering'),
    // Explicit shortcut actions that mark one specific milestone done directly, standing in for
    // milestones with no other data signal to auto-detect from (lib/milestone-auto.js's comments
    // explain why each of these three can't be inferred the way Production/QC/Dispatch/Procurement
    // are). Design head internally approving the design, and Installation confirming its own two
    // milestones on the ground, are real actions — just not something this app can see happen on
    // its own the way a job card or a QC record closing can.
    canApproveDesign: isDesignHead(user),
    // Permission-aware UI (roadmap item 4, SYSTEM.md §5j): match the real server-side gate
    // (requireAction in app/api/milestones/[id]/route.js) exactly, rather than the coarser
    // department-access check this used to be — a Member who'd get a 403 doesn't see the button.
    canMarkInstallation: await canPerformAction(user, 'Installation', 'installation.milestone.complete'),
  };

  return (
    <main className="container flex flex-col gap-6 py-8">
      {/* Row 1: same Milestone Tracker as the Executive dashboard, scoped to this one project —
          shown to every internal role (heads get the full chain as read-only context), now leading
          the page instead of sitting below the identity row. Full width since the stage bar needs
          the room. */}
      <PortfolioDelayTimeline projects={[{ ...project, milestones }]} />

      {/* Row 2: identity, Open Actions (TodayBand — this project's own overdue/blocked/due-soon
          milestones, the same exception-only ATTENTION set as Operations' cross-project version,
          just scoped to one project), and a third slot showing who currently has the ball —
          department pill(s) + that department's own milestone progress here, computed the same way
          the Projects list computes it (activeDepartmentStatus), not a phase-specific guess. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <ProjectHeader project={project} health={health} blocker={blocker} milestones={milestones} />
        <TodayBand milestones={attentionMilestones} />
        <Card>
          <CardHeader><CardTitle>Currently With</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {departmentProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not started yet.</p>
            ) : (
              <>
                <DepartmentPills departmentProgress={departmentProgress} />
                <DepartmentProgress departmentProgress={departmentProgress} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

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