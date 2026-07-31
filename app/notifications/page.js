import { redirect } from 'next/navigation';
import { getSessionUser, isCustomer, roleHome } from '@/lib/auth';
import { getNotifications } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import NotificationsPanel from '@/components/NotificationsPanel';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = getSessionUser();
  if (isCustomer(user)) redirect(roleHome(user));

  const data = await getNotifications(user.id, 100);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Notifications" />
      <NotificationsPanel initial={data} />
    </main>
  );
}
