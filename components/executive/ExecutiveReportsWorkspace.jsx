'use client';

// components/executive/ExecutiveReportsWorkspace.jsx — sidebar shell for /executive/reports, same
// WorkspaceSidebar pattern every department's Reports tab already uses. Five reports today
// (Management Report, Project/Customer Profitability, Procurement Spend, Manufacturing
// Performance) — the next Management report is a one-line addition to SCREEN + ITEMS below, same
// as ReportsWorkspace.jsx's per-department pattern. Not catalog-driven like the department Reports
// tabs: these reports aren't gated to one department's requireDepartment() check, they're
// requirePM-gated (§1.2's placement reasoning), so lib/reports/catalog.js's department-keyed shape
// doesn't fit them — their PDF routes call renderCatalogPdf directly instead
// (app/api/executive/*/pdf/route.js).
import { useState } from 'react';
import { LandmarkIcon, TrendingUpIcon, UsersIcon, ShoppingCartIcon, HardHatIcon } from 'lucide-react';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import ManagementReportCard from '@/components/executive/ManagementReportCard';
import ProjectProfitabilityCard from '@/components/executive/ProjectProfitabilityCard';
import CustomerProfitabilityCard from '@/components/executive/CustomerProfitabilityCard';
import ProcurementSpendCard from '@/components/executive/ProcurementSpendCard';
import ManufacturingPerformanceCard from '@/components/executive/ManufacturingPerformanceCard';

const ITEMS = [
  { key: 'management-report', label: 'Management Report', icon: LandmarkIcon },
  { key: 'project-profitability', label: 'Project Profitability', icon: TrendingUpIcon },
  { key: 'customer-profitability', label: 'Customer Profitability', icon: UsersIcon },
  { key: 'procurement-spend', label: 'Procurement Spend', icon: ShoppingCartIcon },
  { key: 'manufacturing-performance', label: 'Manufacturing Performance', icon: HardHatIcon },
];

const SCREEN = {
  'management-report': ManagementReportCard,
  'project-profitability': ProjectProfitabilityCard,
  'customer-profitability': CustomerProfitabilityCard,
  'procurement-spend': ProcurementSpendCard,
  'manufacturing-performance': ManufacturingPerformanceCard,
};

export default function ExecutiveReportsWorkspace({ companies }) {
  const [key, setKey] = useState(ITEMS[0].key);
  const Screen = SCREEN[key];
  return (
    <WorkspaceSidebar title="Management Reports" icon={LandmarkIcon} items={ITEMS} activeKey={key} onChange={setKey}>
      <Screen companies={companies} />
    </WorkspaceSidebar>
  );
}
