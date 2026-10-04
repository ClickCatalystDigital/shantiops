// "Inbound": opens the supplier's page for this PO (PO copy + delivery details), creating the link if the
// PO never had one. A plain GET that redirects, so it works as an ordinary link button (new tab, copy link).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getOrCreateSupplierLink } from '@/lib/supplier-link';
import { appUrl } from '@/lib/app-url';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !(canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const r = await getOrCreateSupplierLink(Number(params.id));
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
  // The public address when one is configured (behind a proxy the request's own host can be internal).
  return NextResponse.redirect(appUrl(`/rfq/${r.token}`) || new URL(`/rfq/${r.token}`, req.url));
}
