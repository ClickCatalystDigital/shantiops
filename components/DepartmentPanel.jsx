// One department's slice of a project: its milestones (edit drawer scoped to role) + the department's
// special panel — Engineering → Bill of Materials, Dispatch → Packing, and Procurement / Stores /
// Production → the same BOM table scoped to the columns their department owns (bomFields comes from
// the server via editableBomFields(user)). Every department also gets a cross-department task card
// (TicketsPanel.jsx, repurposed from the old standalone tickets entity) — the one thing every
// department has, including Engineering/Stores who own no milestones.
import MilestoneBoard from './MilestoneBoard';
import BomPanel from './BomPanel';
import PackingPanel from './PackingPanel';
import BomTable from './BomTable';
import QcPanel from './QcPanel';
import TicketsPanel from './TicketsPanel';
import StagesPanel from './StagesPanel';
import ProcurementQueue from './ProcurementQueue';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const BOM_DEPARTMENTS = ['Procurement', 'Stores', 'Production'];

export default function DepartmentPanel({
  department, milestones, head = false,
  projectId, bom = [], pending = [], packingLists = [], canUploadBom = false, canPack = false,
  bomFields = [], bomImports = [], qcRecords = [], canEditQc = false,
  tasks = [], canRaiseTickets = false,
  stages = [], stageTemplates = [], stageTemplateItems = [], canManageStages = false,
}) {
  const deptMs = milestones.filter(m => m.department === department);
  const showBom = BOM_DEPARTMENTS.includes(department) && bom.length > 0;
  const deptTasks = tasks.filter(t => t.department === department || t.from_department === department);
  const deptStages = stages.filter(s => s.department === department);
  const deptTemplates = stageTemplates.filter(t => t.department === department);
  const deptTemplateIds = new Set(deptTemplates.map(t => t.id));
  const deptTemplateItems = stageTemplateItems.filter(i => deptTemplateIds.has(i.template_id));

  return (
    <div className="flex flex-col gap-6">
      {department === 'Engineering' && (
        <BomPanel projectId={projectId} bom={bom} pending={pending} canUpload={canUploadBom}
          editableFields={bomFields} imports={bomImports} />
      )}

      {department === 'Procurement' && bom.length > 0 && (
        <ProcurementQueue bom={bom} tasks={deptTasks} />
      )}

      {showBom && (
        <Card>
          <CardHeader><CardTitle>Master BOM — {department}</CardTitle></CardHeader>
          <CardContent>
            <BomTable projectId={projectId} bom={bom} pendingIds={pending.map(p => p.id)}
              editableFields={bomFields} department={department} />
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
        <QcPanel projectId={projectId} records={qcRecords} canEdit={canEditQc} />
      )}

      {/* Every department gets this cross-department card, including Engineering/Stores who own no
          milestones — this is their home now instead of the old dead-end message. */}
      <TicketsPanel department={department} projectId={projectId} milestones={milestones} bom={bom} tasks={deptTasks} canRaise={canRaiseTickets} />
    </div>
  );
}
