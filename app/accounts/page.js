// app/accounts/page.js — Accounts' own workspace, same gating mechanism as /hr, /qc, /procurement
// (components/Nav.jsx's addDeptTab). ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 0.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCompanySettings, getGstRates, getVendorTdsRates } from '@/lib/data';
import AccountsWorkspace from '@/components/AccountsWorkspace';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Accounts')) redirect(roleHome(user));

  const [companies, gstRates, tdsRates] = await Promise.all([
    getCompanySettings(), getGstRates(), getVendorTdsRates(),
  ]);

  const sp = await searchParams;
  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <AccountsWorkspace companies={companies} gstRates={gstRates} tdsRates={tdsRates} initialTab={sp?.tab} />
    </main>
  );
}
