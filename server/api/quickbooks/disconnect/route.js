// POST {company_id} — revoke at Intuit and forget the tokens.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { disconnect, manageDenied, companyById } from '@/lib/quickbooks';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const why = await manageDenied(user);
  if (why) return NextResponse.json({ error: why }, { status: 403 });
  const { company_id } = await req.json().catch(() => ({}));
  const co = await companyById(company_id);
  if (!co) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await disconnect(co.company);
  await audit('quickbooks_disconnected', { actor: user.username, detail: co.company });
  return NextResponse.json({ ok: true });
}
