'use client';

// components/reports/FixedAssetReportCards.jsx — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. Closes
// the on-screen gap found during live-verification (SYSTEM.md §5ac): these reports had a working
// compute()/toTable()/PDF export via lib/reports/catalog.js but no entry in ReportsWorkspace.jsx's
// SCREEN map, so selecting them in the browser showed "No report selected" — the PDF was the only
// working view. Same shared-inner-component shape as components/reports/AgingCard.jsx (Receivables/
// Payables Aging): one small renderer, columns passed as props, since these three reports (plus
// TDS Deduction Register — the same pre-existing gap, fixed here too) are all "a flat list of rows
// with one or two closing totals," not different enough to earn three separate hand-rolled layouts.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

// columns: [{ label, key, render?, align? }] — render(row) overrides plain row[key] display.
function ListReportCard({ company, endpoint, title, columns, rowsKey, emptyLabel, totals }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/${endpoint}?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, endpoint]);
  if (!data) return null;
  const rows = data[rowsKey] || [];
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {columns.map(c => <th key={c.key} className={`py-1 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map(c => (
                    <td key={c.key} className={`py-1.5 ${c.align === 'right' ? 'tnum text-right' : ''}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-2 text-sm text-muted-foreground">{emptyLabel}</p>}
        </div>
        {totals && (
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-2 text-sm font-medium">
            {totals(data).map(([label, value]) => (
              <span key={label}>{label}: <span className="tnum">{fmt(value)}</span></span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FixedAssetRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="fixed-asset-register" title="Fixed Asset Register" rowsKey="assets"
      emptyLabel="No fixed assets yet."
      columns={[
        { label: 'Asset No', key: 'asset_no' },
        { label: 'Name', key: 'name' },
        { label: 'Category', key: 'category', render: a => a.category || '—' },
        { label: 'Purchased', key: 'purchase_date' },
        { label: 'Method', key: 'method' },
        { label: 'Cost', key: 'cost', align: 'right', render: a => fmt(a.cost) },
        { label: 'Accum. Dep.', key: 'accumulated_depreciation', align: 'right', render: a => fmt(a.accumulated_depreciation) },
        { label: 'Book Value', key: 'book_value', align: 'right', render: a => fmt(a.book_value) },
        { label: 'Status', key: 'status' },
      ]}
      totals={d => [['Total Cost', d.totalCost], ['Total Accum. Dep.', d.totalAccumulatedDepreciation], ['Total Book Value', d.totalBookValue]]}
    />
  );
}

export function DepreciationScheduleCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="depreciation-schedule" title="Depreciation Schedule" rowsKey="lines"
      emptyLabel="No depreciation runs yet."
      columns={[
        { label: 'Period', key: 'period', render: l => `${l.period_year}-${String(l.period_month).padStart(2, '0')}` },
        { label: 'Run Date', key: 'run_date' },
        { label: 'Asset No', key: 'asset_no' },
        { label: 'Asset', key: 'asset_name' },
        { label: 'Method', key: 'method' },
        { label: 'Amount', key: 'amount', align: 'right', render: l => fmt(l.amount) },
      ]}
      totals={d => [['Total Depreciation', d.totalAmount]]}
    />
  );
}

export function TdsRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="tds-register" title="TDS Deduction Register" rowsKey="lines"
      emptyLabel="No TDS deductions yet."
      columns={[
        { label: 'Bill No', key: 'bill_no' },
        { label: 'Date', key: 'bill_date' },
        { label: 'Supplier', key: 'supplier_name' },
        { label: 'PAN', key: 'supplier_pan', render: l => l.supplier_pan || '—' },
        { label: 'Section', key: 'tds_section' },
        { label: 'FY / Qtr', key: 'fy', render: l => `${l.financial_year} ${l.quarter}` },
        { label: 'Rate %', key: 'tds_rate_pct', align: 'right' },
        { label: 'Gross', key: 'total', align: 'right', render: l => fmt(l.total) },
        { label: 'TDS', key: 'tds_amount', align: 'right', render: l => fmt(l.tds_amount) },
      ]}
      totals={d => [['Total Gross', d.totalGross], ['Total TDS Deducted', d.totalTds]]}
    />
  );
}
