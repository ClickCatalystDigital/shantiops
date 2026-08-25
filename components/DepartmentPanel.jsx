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
import JobWorkPanel from './JobWorkPanel';
import TicketsPanel from './TicketsPanel';
import StagesPanel from './StagesPanel';
import ProcurementQueue from './ProcurementQueue';
import DesignPanel from './DesignPanel';
import InstallationMilestoneActions from './InstallationMilestoneActions';
import ScopeOfSupplyPanel from './ScopeOfSupplyPanel';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { TONE_CLASS } from '@/lib/status-styles';

const APPROVED_DRAWING_STATUSES = new Set(['approved', 'as_built']);

// Design moved off the read-only "Master BOM" fallback (2026-08-25) — it now gets the same full
// BomPanel (import/paste/manage) as Engineering, rendered directly in the department === 'Design'
// branch above, so showing this card there too would just be a duplicate.
const BOM_DEPARTMENTS = ['Stores', 'Production'];
// D10 (Group 5 Bundle B) — Eng/Design can cancel a BOM item directly (Enquiry/Comparison/Ordered
// only, enforced server-side). Design has no BOM_FIELD_OWNERS entry (bomFields comes back empty for
// them), so this is what grants them anything to do here at all beyond read-only visibility.
const CANCEL_DEPARTMENTS = ['Engineering', 'Design'];

export default function DepartmentPanel({
  department, milestones, head = false,
  projectId, bom = [], pending = [], packingLists = [], bomAssemblies = [], canUploadBom = false, canPack = false,
  bomFields = [], bomImports = [], qcRecords = [], canEditQc = false, canEditProductionQc = false,
  qcDocuments = [], qcSummary = {},
  jobWorkInspections = [], workOrders = [],
  tasks = [], canRaiseTickets = false,
  stages = [], stageTemplates = [], stageTemplateItems = [], canManageStages = false,
  designSummary = null,
  scopeOfSupply = [], canEditScope = false,
  canApproveDesign = false, canMarkInstallation = false,
}) {
  const deptMs = milestones.filter(m => m.department === department);
  const showBom = BOM_DEPARTMENTS.includes(department) && bom.length > 0;
  const deptTasks = tasks.filter(t => t.department === department || t.from_department === department);
  const deptStages = stages.filter(s => s.department === department);
  const deptTemplates = stageTemplates.filter(t => t.department === department);
  const deptTemplateIds = new Set(deptTemplates.map(t => t.id));
  const deptTemplateItems = stageTemplateItems.filter(i => deptTemplateIds.has(i.template_id));
  const canCancel = CANCEL_DEPARTMENTS.includes(department);
  const hydroMilestoneId = milestones.find(m => m.milestone_key === 'hydro_test')?.id;

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
            editableFields={bomFields} imports={bomImports} canCancel={canCancel} assemblies={bomAssemblies} />
        </>
      )}

      {department === 'Procurement' && bom.length > 0 && (
        <ProcurementQueue bom={bom} />
      )}

      {department === 'Design' && (
        <>
          <DesignPanel projectId={projectId} designSummary={designSummary} scopeOfSupply={scopeOfSupply} canEditScope={canEditScope}
            milestones={deptMs} canApprove={canApproveDesign} />
          <BomPanel projectId={projectId} bom={bom} pending={pending} canUpload={canUploadBom}
            editableFields={bomFields} imports={bomImports} canCancel={canCancel} assemblies={bomAssemblies}
            department="Design" />
        </>
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

      {/* Hydro Test ownership transferred QC -> Production (lib/milestones.js) — the milestone
          already showed up above via deptMs; this is the actual test record (pass/fail, cert no.),
          filtered to hydro-test rows only. Everything else stays under QC's own tab. */}
      {department === 'Production' && (
        <>
          {/* Read-only view of the drawings Design already finalized, so Production has the
              approved GA drawing in hand once the project reaches them (post Procurement/Stores). */}
          <Card>
            <CardHeader><CardTitle>Approved Drawings</CardTitle></CardHeader>
            <CardContent className="flex flex-col divide-y p-0">
              {(designSummary?.drawings || []).filter(d => APPROVED_DRAWING_STATUSES.has(d.status)).map(d => (
                <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm font-medium">{d.name}</span>
                  <div className="flex items-center gap-2">
                    {d.files.map(f => (
                      <a key={f.id} href={f.fileUrl} target="_blank" rel="noreferrer"
                        className="text-xs text-primary underline underline-offset-2">{f.fileName}</a>
                    ))}
                    <Badge className={TONE_CLASS.success} variant="outline">{d.status === 'as_built' ? 'As built' : 'Approved'}</Badge>
                  </div>
                </div>
              ))}
              {!(designSummary?.drawings || []).some(d => APPROVED_DRAWING_STATUSES.has(d.status)) && (
                <p className="px-4 py-3 text-sm text-muted-foreground">No approved drawings yet.</p>
              )}
            </CardContent>
          </Card>
          <QcPanel projectId={projectId} records={qcRecords.filter(r => /hydro/i.test(r.test_type))}
            canEdit={canEditProductionQc} title="Hydro Test" defaultTestType="Hydro Test"
            reworkMilestoneId={hydroMilestoneId} />
        </>
      )}

      {department === 'Installation' && (
        <InstallationMilestoneActions projectId={projectId} milestones={deptMs} canMark={canMarkInstallation} />
      )}

      {department === 'QC' && (
        <>
          {/* Hydro-test rows excluded — QC can still see them lower down if needed via the project
              summary, but the edit/delete controls here would 403 now that Production owns them
              (found as a real bug: this block previously showed unfiltered records with live
              controls that quietly stopped working instead of being visibly QC's or not). Incoming/
              Finished Goods/Subassembly Inspection (STERP items 30-32, §5p) are excluded from this
              generic list too, each getting their own stage-linked panel below instead. */}
          <QcPanel projectId={projectId}
            records={qcRecords.filter(r => !/hydro/i.test(r.test_type) && !['Incoming Inspection', 'Finished Goods Inspection', 'Subassembly Inspection'].includes(r.test_type))}
            canEdit={canEditQc} />
          <QcPanel projectId={projectId} title="Incoming Inspection" defaultTestType="Incoming Inspection"
            records={qcRecords.filter(r => r.test_type === 'Incoming Inspection')} canEdit={canEditQc} />
          <QcPanel projectId={projectId} title="Finished Goods Inspection" defaultTestType="Finished Goods Inspection"
            records={qcRecords.filter(r => r.test_type === 'Finished Goods Inspection')} canEdit={canEditQc}
            linkField="work_order_id" linkOptions={workOrders.map(w => ({ id: w.id, label: w.wo_no }))} showDispatchToggle />
          <QcPanel projectId={projectId} title="Subassembly Inspection" defaultTestType="Subassembly Inspection"
            records={qcRecords.filter(r => r.test_type === 'Subassembly Inspection')} canEdit={canEditQc}
            linkField="assembly_id" linkOptions={bomAssemblies.map(a => ({ id: a.id, label: a.name }))} />
          <JobWorkPanel projectId={projectId} records={jobWorkInspections} canEdit={canEditQc} />
          <QcProjectSummary projectId={projectId} summary={qcSummary} canManage={canEditQc} />
        </>
      )}
    </div>
  );
}