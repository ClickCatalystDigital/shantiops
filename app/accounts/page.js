// app/accounts/page.js — Accounts' own workspace, same gating mechanism as /hr, /qc, /procurement
// (components/Nav.jsx's addDeptTab). ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 0.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome, isDepartmentHead } from '@/lib/auth';
import { getCompanySettings, getGstRates, getVendorTdsRates, getPendingPreDispatchApprovals } from '@/lib/data';
import AccountsWorkspace from '@/components/AccountsWorkspace';
import { getSelectedCompany } from '@/lib/company-filter-server';
import { narrowCompanies } from '@/lib/company-filter.mjs';
import { maxCompanies } from '@/lib/customer-seed';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Accounts')) redirect(roleHome(user));

  const [allCompanies, gstRates, tdsRates, dispatchClearance] = await Promise.all([
    getCompanySettings(), getGstRates(), getVendorTdsRates(), getPendingPreDispatchApprovals(),
  ]);
  // Global company selector: every Accounts card offers only the selected company (All = both).
  const companies = narrowCompanies(allCompanies, getSelectedCompany());

  const sp = await searchParams;
  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <AccountsWorkspace companies={companies} companyCount={allCompanies.length} maxCompanies={maxCompanies()} gstRates={gstRates} tdsRates={tdsRates} dispatchClearance={dispatchClearance} canClearDispatch={isDepartmentHead(user, 'Accounts')}
        initialTab={sp?.tab} user={{ username: user.username, display_name: user.display_name, role: user.role }} />
    </main>
  );
}
