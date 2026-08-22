'use client';

// components/ReportsWorkspace.jsx — the catalog-driven "Reports" tab (REPORT-ENGINE-PLAN Phase 3).
// Distinct from components/ReportKit.jsx's existing browser-print pattern (CRM Reports, Vendor
// Analysis: window.print() against a live dashboard) — this renders audit-grade PDFs generated
// server-side via lib/report-pdf.js's shared frame, for reports meant to be filed/shared, not just
// glanced at. Both patterns coexist; folding /crm-reports into this is a later, separate cleanup.
//
// SCREEN maps a catalog key to its screen component. lib/reports/catalog.js itself can't be
// imported here — it pulls in server-only DB code via each report's compute() route module — so the
// server page (app/reports/page.js) passes down only serializable {key, title} metadata, and this
// file owns the client-safe screen-component mapping.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { BarChart3Icon, DownloadIcon } from 'lucide-react';
import TrialBalanceCard from '@/components/reports/TrialBalanceCard';
import CustomerLedgerCard from '@/components/reports/CustomerLedgerCard';
import StockValuationCard from '@/components/reports/StockValuationCard';
import ProfitLossCard from '@/components/reports/ProfitLossCard';
import BalanceSheetCard from '@/components/reports/BalanceSheetCard';
import Gstr1ReportCard from '@/components/reports/Gstr1ReportCard';
import Gstr3bReportCard from '@/components/reports/Gstr3bReportCard';
import ItcReconciliationReportCard from '@/components/reports/ItcReconciliationReportCard';
import { ArAgingCard, ApAgingCard } from '@/components/reports/AgingCard';
import VendorLedgerCard from '@/components/reports/VendorLedgerCard';
import CashBookCard from '@/components/reports/CashBookCard';
import JournalRegisterCard from '@/components/reports/JournalRegisterCard';
import PurchaseRegisterCard from '@/components/reports/PurchaseRegisterCard';
import SalesRegisterCard from '@/components/reports/SalesRegisterCard';
import InventoryAgingCard from '@/components/reports/InventoryAgingCard';
import StockLedgerCard from '@/components/reports/StockLedgerCard';
import MaterialConsumptionCard from '@/components/reports/MaterialConsumptionCard';
import BankReconciliationReportCard from '@/components/reports/BankReconciliationReportCard';
import WorkOrderRegisterCard from '@/components/reports/WorkOrderRegisterCard';
import ProductionCostVarianceCard from '@/components/reports/ProductionCostVarianceCard';
import ReworkRejectionCard from '@/components/reports/ReworkRejectionCard';
import MaterialUtilizationCard from '@/components/reports/MaterialUtilizationCard';
import LabourUtilizationCard from '@/components/reports/LabourUtilizationCard';
import MaterialShortageCard from '@/components/reports/MaterialShortageCard';
import DrawingRegisterCard from '@/components/reports/DrawingRegisterCard';
import EcnRegisterCard from '@/components/reports/EcnRegisterCard';

const SCREEN = {
  'trial-balance': TrialBalanceCard,
  'customer-ledger': CustomerLedgerCard,
  'stock-valuation': StockValuationCard,
  'profit-loss': ProfitLossCard,
  'balance-sheet': BalanceSheetCard,
  'gstr1': Gstr1ReportCard,
  'gstr3b': Gstr3bReportCard,
  'itc-reconciliation': ItcReconciliationReportCard,
  'ar-aging': ArAgingCard,
  'ap-aging': ApAgingCard,
  'vendor-ledger': VendorLedgerCard,
  'cash-book': CashBookCard,
  'journal-register': JournalRegisterCard,
  'purchase-register': PurchaseRegisterCard,
  'sales-register': SalesRegisterCard,
  'inventory-aging': InventoryAgingCard,
  'stock-ledger': StockLedgerCard,
  'material-consumption': MaterialConsumptionCard,
  'bank-reconciliation': BankReconciliationReportCard,
  'work-order-register': WorkOrderRegisterCard,
  'production-cost-variance': ProductionCostVarianceCard,
  'rework-rejection': ReworkRejectionCard,
  'material-utilization': MaterialUtilizationCard,
  'labour-utilization': LabourUtilizationCard,
  'material-shortage': MaterialShortageCard,
  'drawing-register': DrawingRegisterCard,
  'ecn-register': EcnRegisterCard,
};

export default function ReportsWorkspace({ department, reports, companies }) {
  const [key, setKey] = useState(reports[0]?.key);
  const [company, setCompany] = useState(companies[0]?.company);
  const active = reports.find(r => r.key === key) || reports[0];
  const Screen = active ? SCREEN[active.key] : null;
  const items = reports.map(r => ({ key: r.key, label: r.title, icon: BarChart3Icon }));
  const showCompanySwitcher = active?.needsCompany !== false;

  return (
    <WorkspaceSidebar title={`${department} Reports`} icon={BarChart3Icon} items={items} activeKey={key} onChange={setKey}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {showCompanySwitcher && companies.map(c => (
              <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
                {c.legal_name}
              </Button>
            ))}
          </div>
          {active && !active.hasOwnPdfControl && (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/${active.key}/export?format=pdf${showCompanySwitcher ? `&company=${encodeURIComponent(company)}` : ''}`} target="_blank" rel="noreferrer">
                <DownloadIcon data-icon="inline-start" />PDF
              </a>
            </Button>
          )}
        </div>
        {Screen ? <Screen company={company} /> : <p className="text-sm text-muted-foreground">No report selected.</p>}
      </div>
    </WorkspaceSidebar>
  );
}
