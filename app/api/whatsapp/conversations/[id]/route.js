// One WhatsApp conversation: GET the thread (marks it read), POST a reply, PATCH to hand it to someone else (Sales Head).
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isDepartmentHead } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { sendMessage } from '@/lib/whatsapp';
import { windowOpen } from '@/lib/whatsapp.mjs';
import { notifyUser } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { tabLink } from '@/lib/alert-links.mjs';

// The conversation if this user may see it; otherwise a 403/404 response.
async function load(id) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const conv = await queryOne('SELECT * FROM wa_conversations WHERE id = ?', [id]);
  const scope = salesScope(user);
  if (!conv || (scope && conv.assigned_to !== scope)) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { user, conv };
}

export async function GET(req, { params }) {
  const { res, user, conv } = await load(params.id);
  if (res) return res;
  const messages = await queryAll(
    `SELECT m.id, m.direction, m.body, m.type, m.template_name, m.status, m.error, m.created_at, u.display_name AS sent_by_name
       FROM wa_messages m LEFT JOIN users u ON u.username = m.sent_by WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 200`, [conv.id]);
  // Only the owner opening it clears the unread count — a Head looking in must not hide it from them.
  if (conv.unread && conv.assigned_to === user.username) await execute('UPDATE wa_conversations SET unread = 0 WHERE id = ?', [conv.id]);
  return NextResponse.json({ messages: messages.reverse(), windowOpen: windowOpen(conv.last_inbound_at) });
}

export async function POST(req, { params }) {
  const { res, user, conv } = await load(params.id);
  if (res) return res;
  const b = await req.json();
  try { return NextResponse.json(await sendMessage(conv, user, { text: b.text, template: b.template })); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}

// { assigned_to } — Sales Head / PM only.
export async function PATCH(req, { params }) {
  const { res, user, conv } = await load(params.id);
  if (res) return res;
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only the Sales Head can reassign a conversation' }, { status: 403 });
  const b = await req.json();
  const to = await queryOne(
    `SELECT id, username FROM users WHERE username = ? AND active = 1 AND ((',' || COALESCE(departments,'') || ',') LIKE '%,Sales,%' OR role IN ('admin', 'manager', 'executive'))`, [b.assigned_to]);
  if (!to) return NextResponse.json({ error: 'Pick an active Sales person' }, { status: 400 });
  await execute('UPDATE wa_conversations SET assigned_to = ? WHERE id = ?', [to.username, conv.id]);
  if (to.username !== user.username) {
    await notifyUser(to.id, { kind: 'whatsapp_message', title: `WhatsApp conversation handed to you: ${conv.contact_name || `+${conv.wa_id}`}`,
      body: conv.last_text, link: tabLink('/sales', 'whatsapp', { c: conv.id }), dedupe_key: `wa:assign:${conv.id}:${Date.now()}` });
  }
  await audit('whatsapp_reassigned', { actor: user.username, detail: `+${conv.wa_id}: ${conv.assigned_to || 'nobody'} → ${to.username}` });
  return NextResponse.json({ ok: true });
}
