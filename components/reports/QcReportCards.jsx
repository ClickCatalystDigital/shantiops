'use client';

// components/reports/QcReportCards.jsx — QC's first 3 Report Engine entries (plan §4/§5f). Same
// pre-existing gap this session found and closed for Dispatch's reports (see
// DispatchReportCards.jsx's header comment): a working compute()/toTable()/PDF export but no
// ReportsWorkspace.jsx SCREEN entry, so selecting one showed "No report selected" in the browser.
import { Badge } from '@/components/ui/badge';
import { ListReportCard } from './ListReportCard';

export function TestCertificateRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="test-certificate-register" title="Test Certificate Register" rowsKey="lines"
      emptyLabel="No certificates allocated to a project yet."
      subtitle={d => `${d.total} certificate(s)`}
      columns={[
        { label: 'Certificate No', key: 'certificate_no' },
        { label: 'Cast No', key: 'cast_no' },
        { label: 'Plate No', key: 'plate_no', render: c => c.plate_no || '—' },
        { label: 'Project', key: 'project_no' },
        { label: 'Spec', key: 'material_spec' },
        { label: 'Maker', key: 'steel_maker' },
        { label: 'YS', key: 'ys', align: 'right', render: c => c.ys ?? '—' },
        { label: 'UTS', key: 'uts', align: 'right', render: c => c.uts ?? '—' },
        { label: 'Elong %', key: 'elongation', align: 'right', render: c => c.elongation ?? '—' },
        { label: 'Bend', key: 'bend_test', render: c => c.bend_test || '—' },
      ]}
    />
  );
}

export function QcInspectionSummaryCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="qc-inspection-summary" title="Inspection Pass/Fail Summary" rowsKey="lines"
      emptyLabel="No inspections logged yet."
      subtitle={d => `${d.totalPass} pass · ${d.totalFail} fail · ${d.totalPending} pending`}
      columns={[
        { label: 'Test Type', key: 'test_type' },
        { label: 'Pass', key: 'pass_count', align: 'right' },
        { label: 'Fail', key: 'fail_count', align: 'right' },
        { label: 'Pending', key: 'pending_count', align: 'right' },
      ]}
    />
  );
}

const NCR_STATUS_VARIANT = { open: 'outline', dispositioned: 'secondary', closed: 'default' };
const NCR_DISPOSITION_LABEL = { rework: 'Rework', repair: 'Repair', scrap: 'Scrap', use_as_is: 'Use as-is' };

export function NcrRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="ncr-register" title="NCR Register" rowsKey="lines"
      emptyLabel="No NCRs raised yet."
      subtitle={d => `${d.total} NCR(s) · ${d.open} open · ${d.closed} closed`}
      columns={[
        { label: 'NCR No', key: 'ncr_no' },
        { label: 'Project', key: 'project_no' },
        { label: 'Severity', key: 'severity', render: n => <span className="capitalize">{n.severity}</span> },
        { label: 'Status', key: 'status', render: n => (
          <Badge variant={NCR_STATUS_VARIANT[n.status] || 'outline'}>
            {n.status === 'dispositioned' ? `Dispositioned — ${NCR_DISPOSITION_LABEL[n.disposition] || n.disposition}` : n.status}
          </Badge>
        ) },
        { label: 'Description', key: 'description' },
        { label: 'Raised', key: 'raised_at', render: n => n.raised_at?.slice(0, 10) || '—' },
      ]}
    />
  );
}
