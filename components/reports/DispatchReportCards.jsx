'use client';

// components/reports/DispatchReportCards.jsx — Dispatch's 4 Report Engine entries. Each already had
// a working compute()/toTable()/PDF export (lib/reports/catalog.js) but no ReportsWorkspace.jsx
// SCREEN entry, so selecting any of them in the browser showed "No report selected" — the same gap
// FixedAssetReportCards.jsx first closed for 3 Accounts reports, found again here live-testing the
// Reports sidebar search. DispatchRegisterCard closes a pre-existing gap (that report shipped
// earlier this session, before this bug pattern was known); the other 3 are this session's own new
// reports, so this closes it on day one instead of leaving it to be found again later.
import Link from 'next/link';
import { fmt } from './TrialBalanceCard';
import { ListReportCard } from './ListReportCard';

export function DispatchRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="dispatch-register" title="Dispatch Register" rowsKey="shipments"
      emptyLabel="No dispatched shipments yet."
      subtitle={d => `${d.shipmentCount} shipment(s) · ${fmt(d.totalFreight)} total freight`}
      columns={[
        // Accounts' real, discoverable path into the full document (freight, e-way bill, invoice
        // link, delivery acknowledgement) — they now have read access to /packing/{id}, but had no
        // way to reach it without knowing a packing list's numeric id.
        { label: 'Packing No', key: 'packing_no', render: s => s.id
          ? <Link href={`/packing/${s.id}`} className="text-primary hover:underline">{s.packing_no}</Link>
          : s.packing_no },
        { label: 'Dispatched', key: 'dispatched_at', render: s => s.dispatched_at?.slice(0, 10) || '—' },
        { label: 'Customer', key: 'customer_name' },
        { label: 'Invoice No', key: 'invoice_no', render: s => s.linked_invoice_no || s.invoice_no || '—' },
        { label: 'Freight', key: 'freight_amount', align: 'right', render: s => s.freight_amount ? fmt(s.freight_amount) : '—' },
        { label: 'Paid By', key: 'freight_paid_by', render: s => s.freight_paid_by || '—' },
        { label: 'E-Way Bill', key: 'eway_bill_no', render: s => s.eway_bill_no || '—' },
      ]}
    />
  );
}

export function EwayBillRegisterCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="eway-bill-register" title="E-Way Bill Register" rowsKey="lines"
      emptyLabel="No shipments carrying an e-way bill number yet."
      subtitle={d => `${d.total} e-way bill(s)`}
      columns={[
        { label: 'E-Way Bill No', key: 'eway_bill_no' },
        { label: 'Date', key: 'eway_bill_date', render: s => s.eway_bill_date?.slice(0, 10) || '—' },
        { label: 'Packing No', key: 'packing_no' },
        { label: 'Vehicle No', key: 'vehicle_no', render: s => s.vehicle_no || '—' },
        { label: 'Through', key: 'dispatch_through', render: s => s.dispatch_through || '—' },
        { label: 'Invoice No', key: 'invoice_no', render: s => s.invoice_no || '—' },
      ]}
    />
  );
}

export function FreightCostSummaryCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="freight-cost-summary" title="Freight Cost Summary" rowsKey="lines"
      emptyLabel="No freight captured yet."
      totals={d => [['Total Freight', d.totalFreight], ['Paid by Us', d.byUs], ['Paid by Customer', d.byCustomer]]}
      columns={[
        { label: 'Month', key: 'month' },
        { label: 'Packing No', key: 'packing_no' },
        { label: 'Customer', key: 'customer_name' },
        { label: 'Freight', key: 'freight_amount', align: 'right', render: s => fmt(s.freight_amount) },
        { label: 'Paid By', key: 'freight_paid_by', render: s => s.freight_paid_by === 'customer' ? 'Customer' : 'Us' },
      ]}
    />
  );
}

export function DispatchAgingCard({ company }) {
  return (
    <ListReportCard
      company={company} endpoint="dispatch-aging" title="Pending vs Dispatched Aging" rowsKey="lines"
      emptyLabel="Nothing pending — every packing list has dispatched."
      subtitle={d => `${d.total} shipment(s) still pending`}
      columns={[
        { label: 'Packing No', key: 'packing_no' },
        { label: 'Customer', key: 'customer_name' },
        { label: 'Status', key: 'status' },
        { label: 'Created', key: 'created_at', render: s => s.created_at?.slice(0, 10) || '—' },
        { label: 'Days Open', key: 'days_open', align: 'right' },
      ]}
    />
  );
}
