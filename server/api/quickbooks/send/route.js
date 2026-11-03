// POST {kind: 'invoice'|'receipt'|'bill'|'vendor_payment', id} — send (or retry) one record to QuickBooks now (lib/quickbooks-sync.js).
// Anyone who works with invoices may, demo visitors included: that is the point of the demo, and the target is
// the Intuit sandbox. Connecting and mapping stay Head / owner-pass only.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { sendRecord, KINDS, canSend } from '@/lib/quickbooks-sync';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canSend(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { kind, id } = await req.json().catch(() => ({}));
  if (!KINDS.includes(kind) || !id) return NextResponse.json({ error: 'Send {kind, id}' }, { status: 400 });
  try {
    return NextResponse.json(await sendRecord(kind, id));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
