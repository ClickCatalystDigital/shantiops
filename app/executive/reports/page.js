// app/executive/reports/page.js — dedicated nav tab for cross-department Management reports
// (REPORT-ENGINE-MATURITY.md §1.2), separate from the per-department /reports?dept= catalog tabs.
// Those tabs are gated off for the 'executive' role by design (components/Nav.jsx's isDeptPM
// check) so executives aren't handed 19 operational Accounts reports — this is the director-
// altitude surface that does get its own tab, gated the same way as /executive itself (isManager).
// Sidebar shell (ExecutiveReportsWorkspace) matches every department Reports tab's own
// WorkspaceSidebar pattern, ready for more Management reports without another rewrite.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, isManager, roleHome } from '@/lib/auth';
import { getCompanySettings } from '@/lib/data';
import ExecutiveReportsWorkspace from '@/components/executive/ExecutiveReportsWorkspace';

export const dynamic = 'force-dynamic';

export default async function ExecutiveReports() {
  const user = await getFreshSessionUser();
  if (!isManager(user)) redirect(roleHome(user));

  const companies = await getCompanySettings();

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ExecutiveReportsWorkspace companies={companies} />
    </main>
  );
}
