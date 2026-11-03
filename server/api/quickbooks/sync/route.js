// GET [?company_id=] — QuickBooks state of every issued invoice (by id), failures to retry and today's count,
// for the labels on the invoice list and the QuickBooks card. {enabled: false} when QuickBooks is off here.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { qboConfig, companyById } from '@/lib/quickbooks';
import { syncState, canSend } from '@/lib/quickbooks-sync';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canSend(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!qboConfig()) return NextResponse.json({ enabled: false });
  const id = new URL(req.url).searchParams.get('company_id');
  const companies = id ? [(await companyById(id))?.company].filter(Boolean) : (await queryAll('SELECT company FROM company_settings')).map(r => r.company);
  return NextResponse.json({ enabled: true, ...(await syncState(companies)) });
}
