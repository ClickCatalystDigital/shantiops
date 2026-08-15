// app/rfq/[token]/page.js — the supplier-facing RFQ portal (V2-CHANGES.md Phase 5.1, D12). No
// login: the token itself is the auth. No Nav — the root layout already skips <Nav> whenever
// await getFreshSessionUser() is null (isInternal(null) is false), which it always is here since this route
// is in middleware.js's PUBLIC_PATHS and a supplier never has a session cookie.
import { getRfqByToken } from '@/lib/data';
import RfqPortalForm from '@/components/RfqPortalForm';

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Request for Quotation — {rs.rfq_no}</h1>
        <p className="text-sm text-muted-foreground">Shanti Boilers · for {rs.supplier_name}</p>
      </div>
      <RfqPortalForm token={params.token} rfq={rs} alreadyResponded={!!rs.responded_at} />
    </main>
  );
}
