import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCustomerView } from '@/lib/data';
import { getFreshSessionUser, isCustomer, canAccessProject, roleHome } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import LogoutButton from '@/components/LogoutButton';
import PortalOrderProgress from '@/components/PortalOrderProgress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PortalNotificationBell from '@/components/PortalNotificationBell';

export const dynamic = 'force-dynamic';

export default async function Portal({ params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user) && !canAccessProject(user, params.id)) redirect(roleHome(user));

  const data = await getCustomerView(params.id);
  if (!data) notFound();
  const { project, phases, estDispatch, packingListId, drawings } = data;
  const doneCount = phases.filter(p => p.status === 'done').length;
  const pct = Math.round((doneCount / phases.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="text-base font-bold tracking-tight">SHANTI<span className="text-primary">BOILERS</span></div>
          <div className="flex items-center gap-2">
            {isCustomer(user) && <PortalNotificationBell />}
            <Button asChild variant="ghost" size="sm"><Link href="/help">Help</Link></Button>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="container flex max-w-3xl flex-col gap-6 py-8">
        <div>
          {isCustomer(user) && <Link href="/portal" className="text-sm text-muted-foreground hover:underline">← My Orders</Link>}
          <h1 className="text-2xl font-bold tracking-tight">Order {project.project_no}</h1>
          <p className="text-sm text-muted-foreground">
            {project.description || 'Boiler order'} · Estimated dispatch {estDispatch ? formatDate(estDispatch) : 'TBD'}
          </p>
        </div>

        <PortalOrderProgress phases={phases} drawings={drawings} pct={pct} />

        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent>
            {packingListId
              ? <Button asChild variant="outline" size="sm"><Link href={`/packing/${packingListId}`}>View / download packing list ↗</Link></Button>
              : <p className="text-sm text-muted-foreground">No documents available yet.</p>}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">For any queries, contact your Shanti Boilers project manager.</p>
      </main>
    </div>
  );
}
