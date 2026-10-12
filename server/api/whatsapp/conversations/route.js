// Sales → WhatsApp inbox. A Sales member gets their own conversations; the Sales Head / PM get all.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { listConversations } from '@/lib/whatsapp';
import { toWaId } from '@/lib/whatsapp.mjs';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const scope = salesScope(user);
  const [conversations, accounts] = await Promise.all([
    listConversations(scope),
    queryAll('SELECT company, display_phone FROM whatsapp_accounts WHERE enabled = 1 ORDER BY company'),
  ]);
  return NextResponse.json({ conversations, accounts, seesAll: !scope, me: user.username });
}

// { phone, name?, company? } — start a conversation with a number (the first message must be a template).
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const waId = toWaId(b.phone);
  if (!waId || waId.length < 11) return NextResponse.json({ error: 'Enter the mobile number (10 digits, or with country code)' }, { status: 400 });
  const acc = await queryOne(`SELECT id FROM whatsapp_accounts WHERE enabled = 1 ${b.company ? 'AND company = ?' : ''} ORDER BY id LIMIT 1`, b.company ? [b.company] : []);
  if (!acc) return NextResponse.json({ error: 'WhatsApp is not connected yet (Settings → Sales → WhatsApp)' }, { status: 400 });
  const existing = await queryOne('SELECT id, assigned_to FROM wa_conversations WHERE account_id = ? AND wa_id = ?', [acc.id, waId]);
  if (existing) {
    const scope = salesScope(user);
    if (scope && existing.assigned_to !== scope) return NextResponse.json({ error: 'A colleague already has a conversation with this number' }, { status: 409 });
    return NextResponse.json({ id: Number(existing.id) });
  }
  const p = `%${waId.slice(-10)}`;
  const digits = col => `REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', '')`;
  const lead = await queryOne(`SELECT id, lead_name FROM leads WHERE ${digits('phone')} LIKE ? OR ${digits('telephone')} LIKE ? ORDER BY id DESC LIMIT 1`, [p, p]);
  const customer = await queryOne(`SELECT id FROM customers WHERE ${digits('phone')} LIKE ? ORDER BY id DESC LIMIT 1`, [p]);
  const { lastId } = await execute(
    'INSERT INTO wa_conversations (account_id, wa_id, contact_name, lead_id, customer_id, assigned_to) VALUES (?, ?, ?, ?, ?, ?)',
    [acc.id, waId, String(b.name || '').trim() || lead?.lead_name || null, lead?.id || null, customer?.id || null, user.username]);
  return NextResponse.json({ id: Number(lastId) }, { status: 201 });
}
