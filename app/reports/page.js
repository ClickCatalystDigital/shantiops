// app/reports/page.js — the "Reports" main tab (REPORT-ENGINE-PLAN Phase 3), same gating shape as
// app/accounts/page.js / app/installation/page.js. Catalog-driven: only departments with >=1 entry
// in lib/reports/catalog.js get here at all (components/Nav.jsx only links to it for those
// departments); a direct hit on a department with no reports redirects home same as no access.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCompanySettings } from '@/lib/data';
import { reportsForDepartment } from '@/lib/reports/catalog';
import ReportsWorkspace from '@/components/ReportsWorkspace';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const sp = await searchParams;
  const department = sp?.dept;

  if (!department || !canAccessDepartment(user, department)) redirect(roleHome(user));

  const reports = reportsForDepartment(department).map((r) => ({
    key: r.key, title: r.title,
    needsCompany: r.needsCompany !== false,
    hasOwnPdfControl: !!r.hasOwnPdfControl,
  }));
  if (!reports.length) redirect(roleHome(user));

  const companies = await getCompanySettings();

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ReportsWorkspace department={department} reports={reports} companies={companies} />
    </main>
  );
}
