// One department's slice of a project: its milestones (edit drawer scoped to role) + the department's
// special panel — Engineering → Bill of Materials, Dispatch → Packing, and Procurement / Stores /
// Production → the same BOM table scoped to the columns their department owns (bomFields comes from
// the server via editableBomFields(user)). Every department also gets a Tickets card — the one
// thing every department has, including Engineering/Stores who own no milestones.
import MilestoneBoard from './MilestoneBoard';
import BomPanel from './BomPanel';
import PackingPanel from './PackingPanel';
import BomTable from './BomTable';
import QcPanel from './QcPanel';
import TicketsPanel from './TicketsPanel';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const BOM_DEPARTMENTS = ['Procurement', 'Stores', 'Production'];

export default function DepartmentPanel({
  department, milestones, head = false,
  projectId, bom = [], pending = [], packingLists = [], canUploadBom = false, canPack = false,
  bomFields = [], bomImports = [], qcRecords = [], canEditQc = false,
  tickets = [], canRaiseTickets = false,
}) {
  const deptMs = milestones.filter(m => m.department === department);
  const showBom = BOM_DEPARTMENTS.includes(department) && bom.length > 0;
  const deptTickets = tickets.filter(t => t.to_department === department || t.from_department === department);

  return (
    <div className="flex flex-col gap-6">
      {department === 'Engineering' && (
        <BomPanel projectId={projectId} bom={bom} pending={pending} canUpload={canUploadBom}
          editableFields={bomFields} imports={bomImports} />
      )}

      {showBom && (
        <Card>
          <CardHeader><CardTitle>Master BOM — {department}</CardTitle></CardHeader>
          <CardContent>
            <BomTable projectId={projectId} bom={bom} pendingIds={pending.map(p => p.id)}
              editableFields={bomFields} />
          </CardContent>
        </Card>
      )}

      {deptMs.length > 0 && <MilestoneBoard milestones={deptMs} head={head} />}

      {department === 'Dispatch' && (
        <PackingPanel projectId={projectId} pending={pending} packingLists={packingLists} canPack={canPack} />
      )}

      {department === 'QC' && (
        <QcPanel projectId={projectId} records={qcRecords} canEdit={canEditQc} />
      )}

      {/* Every department gets tickets, including Engineering/Stores who own no milestones —
          this is their home now instead of the old dead-end message. */}
      <TicketsPanel department={department} projectId={projectId} tickets={deptTickets} canRaise={canRaiseTickets} />
    </div>
  );
}
