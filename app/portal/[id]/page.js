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
import { FileTextIcon, DownloadIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Portal({ params }) {
  const user = await getFreshSessionUser();
  if (isCustomer(user) && !canAccessProject(user, params.id)) redirect(roleHome(user));

  const data = await getCustomerView(params.id);
  if (!data) notFound();
  const { project, phases, estDispatch, packingLists, drawings, invoices, qcCertificates, isSplitOrder, unitCount } = data;
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
            {project.description || 'Boiler order'}{isSplitOrder ? ` · ${unitCount} units` : ''} · Estimated
            dispatch {estDispatch ? formatDate(estDispatch) : 'TBD'}
          </p>
        </div>

        <PortalOrderProgress phases={phases} drawings={drawings} qcCertificates={qcCertificates} packingLists={packingLists} pct={pct} />

        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices issued yet.</p>}
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">Invoice — {inv.invoice_no}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(inv.invoice_date)} · ₹{inv.total.toLocaleString('en-IN')}</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <a href={`/api/sales-invoices/${inv.id}/pdf`} download><DownloadIcon className="size-3.5" data-icon="inline-start" />Download</a>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">For any queries, contact your Shanti Boilers project manager.</p>
      </main>
    </div>
  );
}
