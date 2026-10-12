// Approved WhatsApp templates for the number a conversation is on (?conversation=<id>).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { listTemplates } from '@/lib/whatsapp';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const a = await queryOne(
    'SELECT a.* FROM whatsapp_accounts a JOIN wa_conversations c ON c.account_id = a.id WHERE c.id = ?', [new URL(req.url).searchParams.get('conversation')]);
  if (!a) return NextResponse.json([]);
  try { return NextResponse.json(await listTemplates(a)); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
