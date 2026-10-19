import Link from 'next/link';
import CustomerNavLinks from '@/components/CustomerNavLinks';
import { redirect } from 'next/navigation';
import { getCustomerView } from '@/lib/data';
import { getFreshSessionUser, isCustomer, isDepartmentHead, parseProjectIds, roleHome } from '@/lib/auth';
import { queryOne, queryAll } from '@/lib/db';
import { formatDate } from '@/lib/format';
import LogoutButton from '@/components/LogoutButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { defaultCompany } from '@/lib/company-profiles';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

// "My Orders" — a customer's landing page. Always shown, even for a single order, so a company
// with more projects later doesn't need a different flow — one place to see everything they have.
// Sorted newest-first by project id (monotonic and always set, unlike order_date which can be
// null) and paginated once a customer has enough history to need it.
export default async function MyOrders(props) {
  const searchParams = await props.searchParams;
  const user = await getFreshSessionUser();
  // "Open portal" from Sales → Setup → Portal Access: the Sales Head / a PM sees exactly what this
  // customer sees, read-only, without signing them in (which would sign the head out of the app).
  let viewing = user;
  let viewAs = null;
  if (isCustomer(user) && user.must_change_password) redirect('/change-password');
  if (!isCustomer(user)) {
    if (searchParams?.as && isDepartmentHead(user, 'Sales')) {
      viewAs = await queryOne("SELECT id, username, display_name, project_ids FROM users WHERE id = ? AND role = 'customer'", [searchParams.as]);
    } else if (searchParams?.customer && isDepartmentHead(user, 'Sales')) {
      // "Customer portal" on the customer sheet: works before the customer has a login (their own
      // projects, split units folded into the master as the portal does).
      const c = await queryOne('SELECT id, name, portal_user_id FROM customers WHERE id = ?', [searchParams.customer]);
      if (c?.portal_user_id) viewAs = await queryOne("SELECT id, username, display_name, project_ids FROM users WHERE id = ? AND role = 'customer'", [c.portal_user_id]);
      else if (c) {
        const ps = await queryAll('SELECT id FROM projects WHERE customer_id = ? AND master_project_id IS NULL', [c.id]);
        viewAs = { id: null, username: null, display_name: c.name, project_ids: ps.map(p => p.id).join(',') };
      }
    }
    if (!viewAs) redirect(roleHome(user));
    viewing = viewAs;
  }

  const ids = parseProjectIds(viewing.project_ids ?? viewing.project_id);
  const all = (await Promise.all(ids.map(id => getCustomerView(id)))).filter(Boolean);
  all.sort((a, b) => b.project.id - a.project.id);

  // keep the preview (?as= / ?customer=) when paging
  const keep = searchParams?.as ? `as=${encodeURIComponent(searchParams.as)}&` : searchParams?.customer ? `customer=${encodeURIComponent(searchParams.customer)}&` : '';
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams?.page) || 1), totalPages);
  const orders = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-2">
          <CustomerNavLinks active="orders" />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link href="/help">Help</Link></Button>
            <LogoutButton />
          </div>
        </div>
      </header>

      {viewAs && (
        <div className="border-b bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          Viewing the portal as <strong>{viewAs.display_name || viewAs.username}</strong> — read-only preview, you are still signed in as yourself.
        </div>
      )}
      <main className="container flex max-w-3xl flex-col gap-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>

        {orders.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No orders yet — contact your {defaultCompany()} project manager.
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
              ? <Button asChild variant="outline" size="sm"><Link href={`/portal?${keep}page=${page - 1}`}>← Newer</Link></Button>
              : <Button variant="outline" size="sm" disabled>← Newer</Button>}
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            {page < totalPages
              ? <Button asChild variant="outline" size="sm"><Link href={`/portal?${keep}page=${page + 1}`}>Older →</Link></Button>
              : <Button variant="outline" size="sm" disabled>Older →</Button>}
          </div>
        )}
      </main>
    </div>
  );
}
