// app/accounts/documents/page.js — what a company's documents say and how their headers look.
// Opened from Accounts → Company Entities → "Document details and design". Follows the top-bar
// company selector (All companies = the first company).
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getCompanySettings } from '@/lib/data';
import { getSelectedCompany } from '@/lib/company-filter-server';
import { narrowCompanies } from '@/lib/company-filter.mjs';
import DocumentDesign from '@/components/DocumentDesign';

export const dynamic = 'force-dynamic';

export default async function DocumentDesignPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Accounts')) redirect(roleHome(user));
  const companies = narrowCompanies(await getCompanySettings(), getSelectedCompany());
  if (!companies.length) redirect('/accounts?tab=company-entities');
  return <DocumentDesign entity={{ ...companies[0] }} several={companies.length > 1} />;
}
