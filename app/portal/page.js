import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomerView } from '@/lib/data';
import { getFreshSessionUser, isCustomer, parseProjectIds, roleHome } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import LogoutButton from '@/components/LogoutButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

// "My Orders" — a customer's landing page. Always shown, even for a single order, so a company
// with more projects later doesn't need a different flow — one place to see everything they have.
// Sorted newest-first by project id (monotonic and always set, unlike order_date which can be
// null) and paginated once a customer has enough history to need it.
export default async function MyOrders({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!isCustomer(user)) redirect(roleHome(user));

  const ids = parseProjectIds(user.project_ids ?? user.project_id);
  const all = (await Promise.all(ids.map(id => getCustomerView(id)))).filter(Boolean);
  all.sort((a, b) => b.project.id - a.project.id);

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams?.page) || 1), totalPages);
  const orders = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

      <main className="container flex max-w-3xl flex-col gap-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>

        {orders.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No orders yet — contact your Shanti Boilers project manager.
          </CardContent></Card>
        )}

        {orders.map(({ project, phases, estDispatch }) => {
          const doneCount = phases.filter(p => p.status === 'done').length;
          const pct = Math.round((doneCount / phases.length) * 100);
          const current = phases.find(p => p.status === 'in_progress') || phases.find(p => p.status !== 'done');
          return (
            <Link key={project.id} href={`/portal/${project.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardHeader><CardTitle className="flex items-center justify-between text-base">
                  <span>{project.project_no}</span>
                  <span className="text-sm font-normal text-muted-foreground">{pct}%</span>
                </CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">{project.description || 'Boiler order'}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{current?.label || 'Commissioning'}</span>
                    <span>Est. dispatch {estDispatch ? formatDate(estDispatch) : 'TBD'}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            {page > 1
              ? <Button asChild variant="outline" size="sm"><Link href={`/portal?page=${page - 1}`}>← Newer</Link></Button>
              : <Button variant="outline" size="sm" disabled>← Newer</Button>}
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            {page < totalPages
              ? <Button asChild variant="outline" size="sm"><Link href={`/portal?page=${page + 1}`}>Older →</Link></Button>
              : <Button variant="outline" size="sm" disabled>Older →</Button>}
          </div>
        )}
      </main>
    </div>
  );
}
