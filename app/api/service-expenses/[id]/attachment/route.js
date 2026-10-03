// One receipt of a travel claim (?key=…), same visibility as the claim; the key must belong to this claim.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { getRequest, canView } from '@/lib/service-expenses';
import { getObjectBuffer } from '@/lib/r2';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const r = await getRequest(Number(params.id));
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canView(user, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const key = new URL(req.url).searchParams.get('key') || '';
  const att = Object.values(r.data.attachments || {}).flat().find(a => a.key === key);
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await getObjectBuffer(key);
  return new NextResponse(body, { headers: { 'Content-Type': att.type, 'Content-Disposition': `inline; filename="${att.name.replace(/"/g, '')}"` } });
}
