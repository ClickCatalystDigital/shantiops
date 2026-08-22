// app/reports/page.js — the "Reports" main tab (REPORT-ENGINE-PLAN Phase 3), same gating shape as
// app/accounts/page.js / app/installation/page.js. Catalog-driven: only departments with >=1 entry
// in lib/reports/catalog.js get here at all (components/Nav.jsx only links to it for those
// departments); a direct hit on a department with no reports redirects home same as no access.
//
// No ?dept= query, for admin/manager only: the consolidated "All Reports" view (2026-08-22) —
// every department's reports plus the Management reports, one sidebar with groups, instead of the
// wall of identically-labeled per-department "Reports" tabs Nav.jsx used to build for this
// audience. Single-department heads and the pure 'executive' role never hit this branch: a head's
// own Nav tab always carries ?dept=, and 'executive' keeps its own /executive/reports tab (it has
// no department access to consolidate).
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCompanySettings } from '@/lib/data';
import { reportsForDepartment, REPORT_DEPARTMENTS } from '@/lib/reports/catalog';
import ReportsWorkspace from '@/components/ReportsWorkspace';

export const dynamic = 'force-dynamic';

// Same admin/manager definition Nav.jsx's isDeptPM uses — kept in sync by comment, not import,
// since Nav.jsx is a client component and this file needs its own server-side check.
function isDeptPM(user) {
  return !!user && ['admin', 'manager'].includes(user.role);
}

const MANAGEMENT_REPORTS = [
  { key: 'management-report', title: 'Management Report' },
  { key: 'project-profitability', title: 'Project Profitability' },
  { key: 'customer-profitability', title: 'Customer Profitability' },
  { key: 'procurement-spend', title: 'Procurement Spend' },
  { key: 'manufacturing-performance', title: 'Manufacturing Performance' },
].map((r) => ({ ...r, hasOwnControls: true }));

export default async function ReportsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const sp = await searchParams;
  const department = sp?.dept;
  const companies = await getCompanySettings();

  if (!department) {
    if (!isDeptPM(user)) redirect(roleHome(user));
    const groups = [
      ...REPORT_DEPARTMENTS.map((dept) => ({
        department: dept,
        reports: reportsForDepartment(dept).map((r) => ({
          key: r.key, title: r.title,
          needsCompany: r.needsCompany !== false,
          hasOwnPdfControl: !!r.hasOwnPdfControl,
        })),
      })),
      { department: 'Management', reports: MANAGEMENT_REPORTS },
    ];
    return (
      <main className="min-h-[calc(100svh-3.5rem)]">
        <ReportsWorkspace groups={groups} companies={companies} />
      </main>
    );
  }

  if (!canAccessDepartment(user, department)) redirect(roleHome(user));

  const reports = reportsForDepartment(department).map((r) => ({
    key: r.key, title: r.title,
    needsCompany: r.needsCompany !== false,
    hasOwnPdfControl: !!r.hasOwnPdfControl,
  }));
  if (!reports.length) redirect(roleHome(user));

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ReportsWorkspace department={department} reports={reports} companies={companies} />
    </main>
  );
}
