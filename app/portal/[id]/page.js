import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCustomerView } from '@/lib/data';
import { getFreshSessionUser, isCustomer, canAccessProject, roleHome } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import LogoutButton from '@/components/LogoutButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckIcon, LoaderIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Portal({ params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user) && !canAccessProject(user, params.id)) redirect(roleHome(user));

  const data = await getCustomerView(params.id);
  if (!data) notFound();
  const { project, phases, estDispatch, packingListId } = data;
  const doneCount = phases.filter(p => p.status === 'done').length;
  const pct = Math.round((doneCount / phases.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="text-base font-bold tracking-tight">SHANTI<span className="text-primary">BOILERS</span></div>
          <div className="flex items-center gap-2">
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

        <Card>
          <CardHeader><CardTitle>Order Progress — {pct}%</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ol className="flex flex-col">
              {phases.map((ph, i) => (
                <li key={ph.key} className="flex items-center gap-3 py-2">
                  <span className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs',
                    ph.status === 'done' ? 'bg-success text-white'
                      : ph.status === 'in_progress' ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {ph.status === 'done' ? <CheckIcon className="size-4" />
                      : ph.status === 'in_progress' ? <LoaderIcon className="size-4" /> : i + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium">{ph.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {ph.status === 'done' ? 'Completed' : ph.status === 'in_progress' ? 'In progress' : 'Upcoming'}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

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
