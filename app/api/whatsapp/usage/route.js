// This month's WhatsApp spend and message counts for one company's number (read live from Meta).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { usage } from '@/lib/whatsapp';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const a = await queryOne('SELECT * FROM whatsapp_accounts WHERE company = ?', [new URL(req.url).searchParams.get('company')]);
  if (!a) return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  try { return NextResponse.json(await usage(a)); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
