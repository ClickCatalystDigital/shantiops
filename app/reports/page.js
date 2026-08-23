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
import { getFreshSessionUser, canAccessDepartment, headDepartments, roleHome } from '@/lib/auth';
import { getCompanySettings, getLeads, getOpportunities, getCampaigns, getSalesStages, getCrmTasks, getLeadNotes, getFunctionalHeads } from '@/lib/data';
import { reportsForDepartment, REPORT_DEPARTMENTS } from '@/lib/reports/catalog';
import ReportsWorkspace from '@/components/ReportsWorkspace';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

// Same data the standalone /crm-reports page fetches (app/crm-reports/page.js) — the 6 CRM
// analytics catalog entries (lib/reports/catalog.js, §5an) need it, fetched only when a Sales or
// Marketing report could actually be in view, not on every unrelated department's Reports tab.
async function getCrmData() {
  const [leads, opportunities, campaigns, stages, tasks, notes, heads] = await Promise.all([
    getLeads(), getOpportunities(), getCampaigns(), getSalesStages(), getCrmTasks(), getLeadNotes(), getFunctionalHeads(),
  ]);
  const users = heads.filter(h => h.active && h.departments.some(d => CRM_DEPARTMENTS.includes(d)));
  return { leads, opportunities, campaigns, stages, tasks, notes, users };
}

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
    // Generalized (2026-08-23, plan §3) beyond admin/manager: a non-PM head granted 2+ departments
    // that each have catalog reports also lands here, scoped to just their own departments — the
    // alternative (Nav.jsx building one "Reports" tab per department) produced N identically-labeled
    // tabs. isDeptPM still gets every department; everyone else gets the intersection with their own
    // grants, and redirects home only if that intersection is empty.
    const isPmView = isDeptPM(user);
    const myReportDepts = isPmView ? REPORT_DEPARTMENTS : REPORT_DEPARTMENTS.filter(d => headDepartments(user).includes(d));
    if (myReportDepts.length === 0) redirect(roleHome(user));
    const groups = [
      // Management first — the group a PM/admin actually opens most on this consolidated view,
      // not buried after 8 other departments' worth of scrolling. PM-only, never shown to a head.
      ...(isPmView ? [{ department: 'Management', reports: MANAGEMENT_REPORTS }] : []),
      ...myReportDepts.map((dept) => ({
        department: dept,
        reports: reportsForDepartment(dept).map((r) => ({
          key: r.key, title: r.title,
          needsCompany: r.needsCompany !== false,
          hasOwnPdfControl: !!r.hasOwnPdfControl,
          hasOwnControls: !!r.hasOwnControls,
        })),
      })),
    ];
    // Only fetch CRM data when Sales/Marketing is actually in view — same guard the
    // single-department branch below already uses, not assumed just because this is the
    // multi-department branch.
    const crmData = myReportDepts.some(d => CRM_DEPARTMENTS.includes(d)) ? await getCrmData() : undefined;
    // Title reflects what's actually shown — "All Reports" only when it truly is all of them.
    const title = isPmView ? 'All Reports' : `${myReportDepts.join(' & ')} Reports`;
    return (
      <main className="min-h-[calc(100svh-3.5rem)]">
        <ReportsWorkspace groups={groups} companies={companies} crmData={crmData} title={title} />
      </main>
    );
  }

  if (!canAccessDepartment(user, department)) redirect(roleHome(user));

  const reports = reportsForDepartment(department).map((r) => ({
    key: r.key, title: r.title,
    needsCompany: r.needsCompany !== false,
    hasOwnPdfControl: !!r.hasOwnPdfControl,
    hasOwnControls: !!r.hasOwnControls,
  }));
  if (!reports.length) redirect(roleHome(user));

  const crmData = CRM_DEPARTMENTS.includes(department) ? await getCrmData() : undefined;

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ReportsWorkspace department={department} reports={reports} companies={companies} crmData={crmData} />
    </main>
  );
}
