// app/api/customers/similar/route.js — Sales CRM plan 1k. GET ?name=&gst_no=&phone=[&exclude_id=]
// -> up to 5 existing customers that look like the same party (lib/customer-match.mjs). Suggestion
// only; never blocks anything by itself.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { similarCustomers } from '@/lib/customer-match.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const input = { name: sp.get('name') || '', gst_no: sp.get('gst_no') || '', phone: sp.get('phone') || '' };
  if (!input.name.trim() && !input.gst_no.trim() && !input.phone.trim()) return NextResponse.json([]);
  const customers = await queryAll('SELECT id, name, gst_no, phone FROM customers WHERE active = 1');
  return NextResponse.json(similarCustomers(input, customers, { excludeId: Number(sp.get('exclude_id')) || null }));
}
