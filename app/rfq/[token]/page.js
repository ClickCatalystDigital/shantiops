// app/rfq/[token]/page.js — the supplier-facing RFQ portal (V2-CHANGES.md Phase 5.1, D12). No
// login: the token itself is the auth. No Nav — the root layout already skips <Nav> whenever
// await getFreshSessionUser() is null (isInternal(null) is false), which it always is here since this route
// is in middleware.js's PUBLIC_PATHS and a supplier never has a session cookie.
import { getRfqByToken } from '@/lib/data';
import RfqPortalForm from '@/components/RfqPortalForm';
import SupplierOrders from '@/components/SupplierOrders';

export const dynamic = 'force-dynamic';

export default async function RfqPortalPage({ params }) {
  const rs = await getRfqByToken(params.token);

  if (!rs) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Link not found</h1>
        <p className="text-sm text-muted-foreground">This RFQ link doesn't exist. Please check the link Procurement sent you.</p>
      </main>
    );
  }

  if (rs.token_expires && rs.token_expires < Date.now()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Link expired</h1>
        <p className="text-sm text-muted-foreground">This RFQ link has expired. Please contact Procurement for a fresh one.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-lg font-semibold">{rs.is_po_link ? `Purchase order — ${rs.po_no}` : `Request for Quotation — ${rs.rfq_no}`}</h1>
        <p className="text-sm text-muted-foreground">SB Ops · for {rs.supplier_name}</p>
      </div>
      <SupplierOrders token={params.token} orders={rs.orders} />
      {rs.is_po_link && !rs.orders.length && (
        <p className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">This order isn't available any more. Please contact Procurement.</p>
      )}
      {/* Quoting is over once an order exists (chosen, PO issued): the order section above is all they need. */}
      {!rs.is_po_link && !rs.orders.length && <RfqPortalForm token={params.token} rfq={rs} alreadyResponded={!!rs.responded_at} />}
    </main>
  );
}
