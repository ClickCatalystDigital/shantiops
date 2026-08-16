// One department's slice of a project: its milestones (edit drawer scoped to role) + the department's
// special panel — Engineering → Bill of Materials, Dispatch → Packing, and Stores / Production → the
// same BOM table scoped to the columns their department owns (bomFields comes from the server via
// editableBomFields(user)). Every department also gets a cross-department task card (TicketsPanel.jsx,
// repurposed from the old standalone tickets entity) — the one thing every department has, including
// Engineering/Stores who own no milestones. Procurement is the deliberate exception to both: its BOM
// work moved entirely to /procurement (§4 of the redesign) and its Tickets/Raise card moved to the
// Requests tab (§4.0b) — this page shows it only the Milestone board, Stages, and ProcurementQueue.
import MilestoneBoard from './MilestoneBoard';
import BomPanel from './BomPanel';
import PackingPanel from './PackingPanel';
import BomTable from './BomTable';
import QcPanel from './QcPanel';
import QcProjectSummary from './QcProjectSummary';
import TicketsPanel from './TicketsPanel';
import StagesPanel from './StagesPanel';
import ProcurementQueue from './ProcurementQueue';
import DesignPanel from './DesignPanel';
import ScopeOfSupplyPanel from './ScopeOfSupplyPanel';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const BOM_DEPARTMENTS = ['Stores', 'Production', 'Design'];
// D10 (Group 5 Bundle B) — Eng/Design can cancel a BOM item directly (Enquiry/Comparison/Ordered
// only, enforced server-side). Design has no BOM_FIELD_OWNERS entry (bomFields comes back empty for
// them), so this is what grants them anything to do here at all beyond read-only visibility.
const CANCEL_DEPARTMENTS = ['Engineering', 'Design'];

export default function DepartmentPanel({
  department, milestones, head = false,
  projectId, bom = [], pending = [], packingLists = [], canUploadBom = false, canPack = false,
  bomFields = [], bomImports = [], qcRecords = [], canEditQc = false,
  qcDocuments = [], qcSummary = {},
  tasks = [], canRaiseTickets = false,
  stages = [], stageTemplates = [], stageTemplateItems = [], canManageStages = false,
  designSummary = null,
  scopeOfSupply = [], canEditScope = false,
}) {
  const deptMs = milestones.filter(m => m.department === department);
  const showBom = BOM_DEPARTMENTS.includes(department) && bom.length > 0;
  const deptTasks = tasks.filter(t => t.department === department || t.from_department === department);
  const deptStages = stages.filter(s => s.department === department);
  const deptTemplates = stageTemplates.filter(t => t.department === department);
  const deptTemplateIds = new Set(deptTemplates.map(t => t.id));
  const deptTemplateItems = stageTemplateItems.filter(i => deptTemplateIds.has(i.template_id));
  const canCancel = CANCEL_DEPARTMENTS.includes(department);

  return (
    <div className="flex flex-col gap-6">
      {/* Incidents (renamed from Tickets) — every department except Procurement gets this
          cross-department card; Procurement's moved to the Requests tab (§4.0b). Moved here from
          the bottom of the panel so it sits right under Open Actions instead of last on the page. */}
      {department !== 'Procurement' && (
        <TicketsPanel department={department} projectId={projectId} milestones={milestones} bom={bom} tasks={deptTasks} canRaise={canRaiseTickets} />
      )}

      {department === 'Engineering' && (
        <>
          <ScopeOfSupplyPanel projectId={projectId} scopeOfSupply={scopeOfSupply} canEdit={canEditScope} />
          <BomPanel projectId={projectId} bom={bom} pending={pending} canUpload={canUploadBom}
            editableFields={bomFields} imports={bomImports} canCancel={canCancel} />
        </>
      )}

      {department === 'Procurement' && bom.length > 0 && (
        <ProcurementQueue bom={bom} />
      )}

      {department === 'Design' && (
        <DesignPanel projectId={projectId} designSummary={designSummary} scopeOfSupply={scopeOfSupply} canEditScope={canEditScope} />
      )}

      {showBom && (
        <Card>
          <CardHeader><CardTitle>Master BOM — {department}</CardTitle></CardHeader>
          <CardContent>
            <BomTable projectId={projectId} bom={bom} pendingIds={pending.map(p => p.id)}
              editableFields={bomFields} department={department} canCancel={canCancel} />
          </CardContent>
        </Card>
      )}

      {deptMs.length > 0 && (
        <>
          <MilestoneBoard milestones={deptMs} head={head} />
          <StagesPanel department={department} milestones={deptMs} stages={deptStages}
            stageTemplates={deptTemplates} stageTemplateItems={deptTemplateItems} canManage={canManageStages} />
        </>
      )}

      {department === 'Dispatch' && (
        <PackingPanel projectId={projectId} pending={pending} packingLists={packingLists} canPack={canPack} />
      )}

      {department === 'QC' && (
        <>
          <QcPanel projectId={projectId} records={qcRecords} canEdit={canEditQc} />
          <QcProjectSummary projectId={projectId} summary={qcSummary} canManage={canEditQc} />
        </>
      )}
    </div>
  );
}