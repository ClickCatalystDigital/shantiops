// app/projects/[id]/page.js — Project View redesign. One unified layout for every internal role
// (Decision A): a project-context/history page, not a department operational workspace. Row 1 stays
// the read-only milestone tracker (Decision B, unchanged). Row 2 is always 3 fixed columns, the
// third a live, multi-department-capable "who's actually got this right now" card (Decision C,
// lib/data.js's getDepartmentState). Lower rows accumulate as the project moves through departments
// and never disappear or swap (Decision D). Milestone EDITING moved off this page entirely, onto a
// new PM-only route (Decision E, /projects/[id]/milestones) — this page has no MilestoneBoard/Drawer,
// no StagesPanel/Kanban, no Incidents/TicketsPanel, and no full Scope-of-Supply editor (moved to
// /projects, Part 4) anymore. Most editors this page used to embed inline (QC's test records,
// Dispatch's Pending PDF/history, Stores' receive dialog, Production's Prod.Done toggle) now have an
// equivalent, verified-first home on their own main workspace — this page only summarizes and links.
// The BOM card is the one deliberate exception, per direct instruction: it's the full shared
// BomTable (search/filter/Add/Edit/Delete/Cancel/Receive/Prod.Done, same as every department panel),
// column/edit-scoped to the viewer's own department(s) — the only thing missing versus the old
// BomPanel.jsx is PMB upload, which now lives on the Engineering BOM workspace's own Import button.
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import {
  getProjectDetail, getProjectBom, getProjectPackingLists, getProjectDesignSummary, getScopeOfSupply,
  getDepartmentState, getQcProjectSummary, getJobCards, getMaterialIndentsByProject,
  getProjectInventoryItems, attachDeliveryLotDates, getBomAssembliesFlat, getCustomers,
} from '@/lib/data';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import { getFreshSessionUser, isCustomer, isPM, isHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import ProjectHeader from '@/components/ProjectHeader';
import TodayBand from '@/components/TodayBand';
import PortfolioDelayTimeline from '@/components/PortfolioDelayTimeline';
import DepartmentStateCard from '@/components/DepartmentStateCard';
import ProjectDesignRow from '@/components/ProjectDesignRow';
import ProcurementQueue from '@/components/ProcurementQueue';
import StoresSummaryCard from '@/components/StoresSummaryCard';
import ProductionSummaryCard from '@/components/ProductionSummaryCard';
import QcProjectSummary from '@/components/QcProjectSummary';
import DispatchSummaryCard from '@/components/DispatchSummaryCard';
import CommonBomCard from '@/components/CommonBomCard';
import InstallationMilestoneActions from '@/components/InstallationMilestoneActions';
import ChildUnitBomCard from '@/components/ChildUnitBomCard';
import ProductionBatchJobCardPanel from '@/components/ProductionBatchJobCardPanel';
import QcBatchDocumentPanel from '@/components/QcBatchDocumentPanel';
import DispatchBatchPackingPanel from '@/components/DispatchBatchPackingPanel';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user)) redirect(roleHome(user)); // customers use the portal, not the ops view

  const data = await getProjectDetail(params.id);
  if (!data) notFound();
  const { project, milestones, health, blocker, hasChildren } = data;

  // Edit Project (2026-09-18) — same gate PATCH /api/projects/[id] itself enforces
  // (requireCalcAccess): PM + Design/Engineering heads.
  const canEditProject = canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');

  const [
    { bom, pending, imports }, packingLists, designSummary, scopeOfSupply, departmentState, qcSummary,
    jobCards, materialIndents, inventoryItems, assemblies, editCustomers,
  ] = await Promise.all([
    getProjectBom(params.id),
    getProjectPackingLists(params.id),
    getProjectDesignSummary(project.id),
    getScopeOfSupply(project.id),
    getDepartmentState(project),
    getQcProjectSummary(params.id),
    getJobCards({ projectId: project.id }),
    getMaterialIndentsByProject(project.id),
    getProjectInventoryItems(project.id),
    getBomAssembliesFlat(project.id),
    canEditProject ? getCustomers() : [],
  ]);
  // Expected delivery lots (Decision K) — reuses the exact function Stores' own Receive-a-Delivery
  // tab already uses, never a second calculation. Only meaningful for open (not yet terminal) lines.
  const openForDelivery = bom.filter(b => !['Received', 'In-Stock', 'Cancelled'].includes(b.purchase_status));
  const withDates = await attachDeliveryLotDates(openForDelivery);
  const deliveryLotsCount = withDates.filter(it => it.nearest_expected_delivery).length;

  const pm = isPM(user);
  const head = isHead(user);
  const myDepts = headDepartments(user);
  const attentionMilestones = head ? milestones.filter(m => myDepts.includes(m.department)) : milestones;

  // Restored BOM card — same viewer-department resolution ReleaseBomTab (components/PrWorkspace.jsx)
  // already uses: a PM gets every department's editable fields (and a column-view department string
  // outside the narrowed Procurement/Engineering set, lib/bom-fields.mjs); a head gets the union of
  // their own granted departments.
  const bomDepartments = pm ? Object.keys(BOM_FIELD_OWNERS) : myDepts;
  // Design has no BOM_FIELD_OWNERS entry of its own — shares Engineering's (lib/bom-fields.mjs's
  // editableBomFields() does the same mapping for the API side; kept as its own line here rather
  // than a shared call since PM's bomDepartments/BOM_FIELD_OWNERS-keys shape differs from that
  // function's full-BOM_FIELDS PM behavior).
  const bomEditableFields = bomDepartments.flatMap(d => BOM_FIELD_OWNERS[d === 'Design' ? 'Engineering' : d] || []);
  const bomTableDepartment =
    bomDepartments.length > 0 && bomDepartments.every(d => ['Design', 'Engineering'].includes(d)) ? 'Engineering'
      : bomDepartments.includes('Stores') ? 'Stores'
        : bomDepartments.includes('Production') ? 'Production'
          : bomDepartments[0] || 'Engineering';
  const canCancelBom = bomDepartments.includes('Design') || bomDepartments.includes('Engineering');

  // Accumulate-once-reached visibility, never based on the viewer's own department access (Decision
  // A — every authorized viewer sees the same context). Each gate reads data already fetched for
  // the card's own content, using signals that are realistically forward-only in normal operation
  // (purchase_status advancement, job cards/packing lists that are never deleted) so a card doesn't
  // flicker away once the underlying work finishes — see the plan's own Part 6/J note on this.
  const showProcurement = bom.length > 0;
  const showStores = bom.some(b => ['Transit', 'Received', 'In-Stock'].includes(b.purchase_status));
  const showProduction = jobCards.length > 0 || materialIndents.length > 0;
  const showQc = qcSummary.certs_total > 0 || qcSummary.docs_total > 0 || qcSummary.ncrs_total > 0;
  const showDispatch = packingLists.length > 0;

  const canMarkInstallation = await canPerformAction(user, 'Installation', 'installation.milestone.complete');

  return (
    <main className="container flex flex-col gap-6 py-8">
      {pm && (
        <div className="flex justify-end">
          <Link href={`/projects/${project.id}/milestones`} className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Manage Milestones
          </Link>
        </div>
      )}

      {/* Row 1 — unchanged: the same read-only Milestone Tracker every role sees. */}
      <PortfolioDelayTimeline projects={[{ ...project, milestones }]} />

      {/* Row 2 — always 3 fixed columns. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <ProjectHeader project={project} health={health} blocker={blocker} milestones={milestones}
          canEdit={canEditProject} customers={editCustomers} scopeOfSupply={scopeOfSupply} />
        <TodayBand milestones={attentionMilestones} />
        <DepartmentStateCard departments={departmentState} />
      </div>

      {/* Multi-unit split — untouched by this redesign. */}
      {project.master_project_id && <ChildUnitBomCard projectId={project.id} unitNo={project.unit_no} />}
      {hasChildren && canAccessDepartment(user, 'Production') && <ProductionBatchJobCardPanel projectId={project.id} />}
      {hasChildren && canAccessDepartment(user, 'QC') && <QcBatchDocumentPanel projectId={project.id} />}
      {hasChildren && canAccessDepartment(user, 'Dispatch') && <DispatchBatchPackingPanel projectId={project.id} />}

      {/* Lower rows — accumulate, never swap. */}
      <ProjectDesignRow projectId={project.id} scopeOfSupply={scopeOfSupply}
        calcSheets={designSummary?.calcSheets} drawings={designSummary?.drawings} />

      {canAccessDepartment(user, 'Installation') && (milestones.some(m => m.department === 'Installation')) && (
        <InstallationMilestoneActions projectId={project.id} milestones={milestones.filter(m => m.department === 'Installation')} canMark={canMarkInstallation} />
      )}

      {showProcurement && <ProcurementQueue bom={bom} />}
      {showStores && <StoresSummaryCard projectId={project.id} inventoryCount={inventoryItems.length} deliveryLotsCount={deliveryLotsCount} />}
      {showProduction && <ProductionSummaryCard jobCards={jobCards} materialIndents={materialIndents} />}
      {showQc && <QcProjectSummary projectId={project.id} summary={qcSummary} canManage={canAccessDepartment(user, 'QC')} />}
      {showDispatch && <DispatchSummaryCard projectId={project.id} packingLists={packingLists} />}

      <CommonBomCard projectId={project.id} bom={bom} pendingIds={pending.map(p => p.id)}
        editableFields={bomEditableFields} department={bomTableDepartment} canCancel={canCancelBom}
        assemblies={assemblies} imports={imports} />
    </main>
  );
}
