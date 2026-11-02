// GET ?company_id= — the connected QuickBooks company's active accounts (Account query), for the
// mapping dropdowns. Read-only, so any Accounts user (and demo visitors) may load it.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { qboGet, companyById } from '@/lib/quickbooks';
import { normalizeAccounts } from '@/lib/quickbooks.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const co = await companyById(new URL(req.url).searchParams.get('company_id'));
  if (!co) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const resp = await qboGet(co.company, '/query', { query: 'select * from Account where Active = true maxresults 1000' });
    return NextResponse.json({ accounts: normalizeAccounts(resp) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
