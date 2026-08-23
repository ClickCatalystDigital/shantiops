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
import {
  BarChart3Icon, DownloadIcon, ScaleIcon, BookUserIcon, TrendingUpIcon, Building2Icon,
  FileOutputIcon, FileCheck2Icon, CheckCheckIcon, ArrowDownCircleIcon, ArrowUpCircleIcon,
  UsersIcon, WalletIcon, BookOpenIcon, PercentIcon, BoxIcon, TrendingDownIcon, WavesIcon,
  LandmarkIcon, WarehouseIcon, PackageSearchIcon, ListOrderedIcon, ClipboardListIcon, ClockIcon,
  ReceiptIcon, FilterIcon, PieChartIcon, UserRoundIcon, Share2Icon, MegaphoneIcon, TruckIcon,
  PackageMinusIcon, FileSpreadsheetIcon, ActivityIcon, RotateCcwIcon, GaugeIcon, HardHatIcon,
  AlertTriangleIcon, PencilRulerIcon, FileEditIcon, ShoppingCartIcon,
  ScrollTextIcon, BanknoteIcon, HourglassIcon, FlaskConicalIcon, ClipboardCheckIcon, ShieldAlertIcon,
} from 'lucide-react';
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
import OpenPoAgingCard from '@/components/reports/OpenPoAgingCard';
import { FixedAssetRegisterCard, DepreciationScheduleCard, TdsRegisterCard } from '@/components/reports/FixedAssetReportCards';
import CashFlowStatementCard from '@/components/reports/CashFlowStatementCard';
import { DispatchRegisterCard, EwayBillRegisterCard, FreightCostSummaryCard, DispatchAgingCard } from '@/components/reports/DispatchReportCards';
import { TestCertificateRegisterCard, QcInspectionSummaryCard, NcrRegisterCard } from '@/components/reports/QcReportCards';
import ManagementReportCard from '@/components/executive/ManagementReportCard';
import ProjectProfitabilityCard from '@/components/executive/ProjectProfitabilityCard';
import CustomerProfitabilityCard from '@/components/executive/CustomerProfitabilityCard';
import ProcurementSpendCard from '@/components/executive/ProcurementSpendCard';
import ManufacturingPerformanceCard from '@/components/executive/ManufacturingPerformanceCard';
import {
  LeadFunnelReport, LeadsBySourceReport, CampaignPerformanceReport,
  SalesPipelineReport, ByDepartmentReport, AgentPerformanceReport,
} from '@/components/CrmReportPanels';

// Exported so app/reports/page.js's consolidated admin/manager view (all departments' reports in
// one sidebar, see the `groups` prop below) can reuse the exact same key→component mapping instead
// of a second copy that would drift the moment a new report is added here.
export const SCREEN = {
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
  'open-po-aging': OpenPoAgingCard,
  'fixed-asset-register': FixedAssetRegisterCard,
  'depreciation-schedule': DepreciationScheduleCard,
  'tds-register': TdsRegisterCard,
  'cash-flow': CashFlowStatementCard,
  // Dispatch/QC report additions (2026-08-23, plan §4/§5f) — dispatch-register closes a
  // pre-existing gap (it shipped earlier this session before this on-screen-card requirement was
  // rediscovered); the other 5 are this session's own new reports.
  'dispatch-register': DispatchRegisterCard,
  'eway-bill-register': EwayBillRegisterCard,
  'freight-cost-summary': FreightCostSummaryCard,
  'dispatch-aging': DispatchAgingCard,
  'test-certificate-register': TestCertificateRegisterCard,
  'qc-inspection-summary': QcInspectionSummaryCard,
  'ncr-register': NcrRegisterCard,
  // Management reports (app/api/executive/*) — folded into the consolidated admin/manager view via
  // `hasOwnControls: true` on their catalog-shaped entries below (app/reports/page.js); these cards
  // already manage their own company switcher + PDF button, same as the standalone
  // ExecutiveReportsWorkspace.jsx that still serves the pure 'executive' role's own tab.
  'management-report': ManagementReportCard,
  'project-profitability': ProjectProfitabilityCard,
  'customer-profitability': CustomerProfitabilityCard,
  'procurement-spend': ProcurementSpendCard,
  'manufacturing-performance': ManufacturingPerformanceCard,
  // CRM analytics (2026-08-23, §5an) — also `hasOwnControls: true`, but takes `crmData` (leads/
  // opportunities/campaigns/stages/tasks/notes/users) instead of `companies`; see the render below.
  'sales_pipeline': SalesPipelineReport,
  'by_department': ByDepartmentReport,
  'agent_performance': AgentPerformanceReport,
  'lead_funnel': LeadFunnelReport,
  'leads_by_source': LeadsBySourceReport,
  'campaign_performance': CampaignPerformanceReport,
};

// Per-report sidebar icon (2026-08-23) — every entry used to render with the same BarChart3Icon,
// making a 44-report sidebar unscannable. Management's 5 reuse the exact icons
// components/executive/ExecutiveReportsWorkspace.jsx already assigned them, so the two surfaces
// showing the same reports stay visually consistent. Falls back to BarChart3Icon for anything new
// added here without a specific choice yet — never a hard error over a missing icon.
const ICON = {
  'trial-balance': ScaleIcon, 'customer-ledger': BookUserIcon, 'profit-loss': TrendingUpIcon,
  'balance-sheet': Building2Icon, 'gstr1': FileOutputIcon, 'gstr3b': FileCheck2Icon,
  'itc-reconciliation': CheckCheckIcon, 'ar-aging': ArrowDownCircleIcon, 'ap-aging': ArrowUpCircleIcon,
  'vendor-ledger': UsersIcon, 'cash-book': WalletIcon, 'journal-register': BookOpenIcon,
  'tds-register': PercentIcon, 'fixed-asset-register': BoxIcon, 'depreciation-schedule': TrendingDownIcon,
  'cash-flow': WavesIcon, 'bank-reconciliation': LandmarkIcon,
  'stock-valuation': WarehouseIcon, 'inventory-aging': PackageSearchIcon, 'stock-ledger': ListOrderedIcon,
  'purchase-register': ClipboardListIcon, 'open-po-aging': ClockIcon,
  'sales-register': ReceiptIcon, 'sales_pipeline': FilterIcon, 'by_department': PieChartIcon,
  'agent_performance': UserRoundIcon,
  'lead_funnel': UsersIcon, 'leads_by_source': Share2Icon, 'campaign_performance': MegaphoneIcon,
  'dispatch-register': TruckIcon, 'eway-bill-register': ScrollTextIcon, 'freight-cost-summary': BanknoteIcon,
  'dispatch-aging': HourglassIcon, 'test-certificate-register': FlaskConicalIcon,
  'qc-inspection-summary': ClipboardCheckIcon, 'ncr-register': ShieldAlertIcon,
  'material-consumption': PackageMinusIcon, 'work-order-register': FileSpreadsheetIcon,
  'production-cost-variance': ActivityIcon, 'rework-rejection': RotateCcwIcon,
  'material-utilization': GaugeIcon, 'labour-utilization': HardHatIcon,
  'material-shortage': AlertTriangleIcon,
  'drawing-register': PencilRulerIcon, 'ecn-register': FileEditIcon,
  'management-report': LandmarkIcon, 'project-profitability': TrendingUpIcon,
  'customer-profitability': UsersIcon, 'procurement-spend': ShoppingCartIcon,
  'manufacturing-performance': HardHatIcon,
};

// `groups` (optional): [{ department, reports }] — the consolidated admin/manager view
// (app/reports/page.js, no ?dept= query) lists every department's reports in one sidebar instead
// of the one-tab-per-department wall Nav.jsx used to produce for that audience. Omit it (pass
// `department`/`reports` instead) for the existing single-department behavior. A report can carry
// `hasOwnControls: true` (currently only the Management reports folded into this view) to mean "my
// own Screen component renders its own company switcher and PDF button" — the parent then renders
// neither and passes `companies` (the full list) instead of a single controlled `company` string.
export default function ReportsWorkspace({ department, reports, groups, companies, crmData, title }) {
  const allReports = groups ? groups.flatMap(g => g.reports) : reports;
  const [key, setKey] = useState(allReports[0]?.key);
  const [company, setCompany] = useState(companies[0]?.company);
  const active = allReports.find(r => r.key === key) || allReports[0];
  const Screen = active ? SCREEN[active.key] : null;
  const showCompanySwitcher = !active?.hasOwnControls && active?.needsCompany !== false;

  const sidebarProps = groups
    ? { groups: groups.map(g => ({ label: g.department, items: g.reports.map(r => ({ key: r.key, label: r.title, icon: ICON[r.key] || BarChart3Icon })) })) }
    : { items: reports.map(r => ({ key: r.key, label: r.title, icon: ICON[r.key] || BarChart3Icon })) };

  return (
    <WorkspaceSidebar title={groups ? (title || 'All Reports') : `${department} Reports`} icon={BarChart3Icon} {...sidebarProps} activeKey={key} onChange={setKey}>
      <div className="flex flex-col gap-4">
        {!active?.hasOwnControls && (
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
        )}
        {Screen ? (active?.hasOwnControls ? <Screen companies={companies} {...crmData} /> : <Screen company={company} />) : <p className="text-sm text-muted-foreground">No report selected.</p>}
      </div>
    </WorkspaceSidebar>
  );
}
