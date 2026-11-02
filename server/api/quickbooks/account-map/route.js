// PUT {company_id, map: {code: qboAccountId|''}} — which QuickBooks account each SB Ops account
// posts to. Checked against the company's own codes and the live QuickBooks account list.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { qboGet, saveAccountMap, manageDenied, companyById } from '@/lib/quickbooks';
import { normalizeAccounts, cleanAccountMap } from '@/lib/quickbooks.mjs';

export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const why = await manageDenied(user);
  if (why) return NextResponse.json({ error: why }, { status: 403 });
  const { company_id, map } = await req.json().catch(() => ({}));
  const co = await companyById(company_id);
  if (!co) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const [local, resp] = await Promise.all([
      queryAll('SELECT code FROM chart_of_accounts WHERE company = ?', [co.company]),
      qboGet(co.company, '/query', { query: 'select * from Account where Active = true maxresults 1000' }),
    ]);
    const { rows, error } = cleanAccountMap(map, local.map(r => r.code), normalizeAccounts(resp).map(a => a.id));
    if (error) return NextResponse.json({ error }, { status: 400 });
    const saved = await saveAccountMap(co.company, rows);
    await audit('quickbooks_account_map', { actor: user.username, detail: `${co.company}: ${rows.length} accounts` });
    return NextResponse.json({ account_map: saved });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
