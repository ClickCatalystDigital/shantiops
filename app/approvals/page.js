import { redirect } from 'next/navigation';
import { getFreshSessionUser, isCustomer, isHead, isPM, roleHome } from '@/lib/auth';
import { getUsbDashboard, getBrowserDashboard, getFunctionalHeads, getPeopleDashboard } from '@/lib/data';
import ApprovalsWorkspace from '@/components/ApprovalsWorkspace';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const user = await getFreshSessionUser();
  if (isCustomer(user) || isHead(user)) redirect(roleHome(user));

  const [data, browser] = await Promise.all([getUsbDashboard(user), getBrowserDashboard(user)]);
  const employees = isPM(user) ? await getFunctionalHeads() : null;
  const people = isPM(user) ? await getPeopleDashboard() : null;

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ApprovalsWorkspace user={user} data={data} browser={browser} employees={employees} people={people} canManagePeople={isPM(user)} />
    </main>
  );
}
