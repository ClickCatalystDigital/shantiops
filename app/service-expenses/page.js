// Service → Expenses (Cash Requests + Travel Allowance forms). Gated like /installation.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import ServiceExpenses from '@/components/ServiceExpenses';

export const dynamic = 'force-dynamic';

export default async function ServiceExpensesPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Installation')) redirect(roleHome(user));
  return <ServiceExpenses user={{ username: user.username, display_name: user.display_name }} />;
}
