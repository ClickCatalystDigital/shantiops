// Shop -> Request a quote (SYSTEM.md §5fh). A signed-in customer's basket becomes a Sales enquiry
// linked to their customer, source "Shop", one product line per item (plus a free-text line for
// "something custom"). Owner = the customer's A/C manager, else the Sales round-robin; they (or the
// Sales Heads) get a lead_received alert. A second request within 24 h is added to the same
// enquiry's Diary instead of opening another enquiry.
// ponytail: customers only. A public visitor form (name/company/phone) is the next step when the
// Shop opens to everyone.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isCustomer } from '@/lib/auth';
import { DEFAULT_STAGE, leadStateForStage } from '@/lib/lead-stage.mjs';
import { resolveProductLines, writeLeadProducts, nextAssignee } from '@/lib/crm';
import { checkSalesPerson } from '@/lib/sales-people';
import { notifyUsername, notifyDepartmentHeads } from '@/lib/notify';
import { tabLink } from '@/lib/alert-links.mjs';
import { audit } from '@/lib/usb';
import { getShopCatalog } from '@/lib/data';

const recent = new Map(); // user id -> request times, for a simple per-hour cap
const MAX_PER_HOUR = 10;

async function alertOwner(username, note) {
  const u = username ? await queryOne('SELECT id FROM users WHERE username = ? AND active = 1', [username]) : null;
  if (u) await notifyUsername(username, note).catch(() => {});
  else await notifyDepartmentHeads('Sales', note).catch(() => {}); // nobody assigned: the Heads see it
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isCustomer(user)) return NextResponse.json({ error: 'Sign in with your customer account to request a quote' }, { status: 403 });

  const now = Date.now();
  const times = (recent.get(user.id) || []).filter(t => now - t < 3600e3);
  if (times.length >= MAX_PER_HOUR) return NextResponse.json({ error: 'Too many requests, please try again later' }, { status: 429 });

  const b = await req.json().catch(() => ({}));
  const shown = new Map((await getShopCatalog()).items.map(i => [i.id, i]));
  const picked = [];
  for (const it of Array.isArray(b.items) ? b.items.slice(0, 50) : []) {
    const item = shown.get(Number(it?.product_id));
    if (!item) return NextResponse.json({ error: 'One of the items is no longer available' }, { status: 400 });
    const qty = it.qty === '' || it.qty == null ? null : Number(it.qty);
    if (qty != null && !(qty > 0 && qty <= 100000)) return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });
    picked.push({ item, qty });
  }
  const custom = String(b.custom || '').trim().slice(0, 2000);
  const note = String(b.note || '').trim().slice(0, 2000);
  if (!picked.length && !custom) return NextResponse.json({ error: 'Add at least one product, or describe what you need' }, { status: 400 });

  const customer = await queryOne('SELECT id, name, phone, email, address, city, pin_code, account_manager FROM customers WHERE portal_user_id = ? AND active = 1', [user.id]);
  if (!customer) return NextResponse.json({ error: 'Your login is not linked to a customer yet. Please contact us.' }, { status: 409 });

  const summary = [
    ...picked.map(({ item, qty }) => `${item.title}${item.model ? ` (${item.model})` : ''}${qty ? ` x ${qty}` : ''}`),
    custom && `Custom: ${custom}`, note && `Note: ${note}`,
  ].filter(Boolean).join('\n');
  const actor = `customer:${user.username}`;
  times.push(now); recent.set(user.id, times);

  const existing = await queryOne(
    `SELECT id, lead_name, assigned_to, account_manager FROM leads
      WHERE converted_customer_id = ? AND source = 'Shop' AND status = 'open' AND created_at >= datetime('now', '-1 day')
      ORDER BY id DESC LIMIT 1`, [customer.id]);
  if (existing) {
    await execute(`INSERT INTO crm_notes (lead_id, customer_id, note_type, content, created_by) VALUES (?, ?, 'note', ?, ?)`,
      [existing.id, customer.id, `Another quote request from the Shop:\n${summary}`, actor]);
    await execute('UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
    await alertOwner(existing.account_manager || existing.assigned_to, {
      kind: 'lead_received', title: `Another Shop quote request: ${existing.lead_name}`, body: summary.slice(0, 300),
      link: tabLink('/sales', 'leads', { highlight: `LD-${existing.id}` }), dedupe_key: `shop_quote:${existing.id}:${now}`,
    });
    await audit('shop_quote_request', { actor, detail: `added to enquiry #${existing.id}` });
    return NextResponse.json({ ok: true, enquiry: existing.id, merged: true });
  }

  let lines;
  try {
    lines = await resolveProductLines([
      ...picked.map(({ item, qty }) => ({ product_id: item.id, qty })),
      ...(custom ? [{ description: custom }] : []),
    ]);
  } catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 500 }); }

  const manager = (await checkSalesPerson(customer.account_manager)).value || null;
  const assignedTo = manager || await nextAssignee('Sales');
  const stageRow = await queryOne('SELECT name, is_won, is_lost FROM sales_stages WHERE name = ?', [DEFAULT_STAGE]);
  const org = String(customer.name || user.display_name || user.username).toUpperCase();
  const { lastId } = await execute(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, owner_dept, notes, assigned_to, account_manager, created_by,
       status, sales_call_status, enquiry_date, address, district, pin_code, reference, converted_customer_id)
     VALUES (?, ?, ?, ?, 'Shop', 'Sales', ?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?, 'Customer Portal Shop', ?)`,
    [org, org, customer.phone || null, customer.email || null, summary, assignedTo, manager, actor,
      leadStateForStage([stageRow], DEFAULT_STAGE), DEFAULT_STAGE, customer.address || null, customer.city || null,
      customer.pin_code || null, customer.id]);
  const id = Number(lastId);
  await execute('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) VALUES (?, ?, ?, ?)', [id, null, DEFAULT_STAGE, actor]);
  if (lines.length) await writeLeadProducts(id, lines);
  await alertOwner(assignedTo, {
    kind: 'lead_received', title: `Shop quote request: ${org}`, body: summary.slice(0, 300),
    link: tabLink('/sales', 'leads', { highlight: `LD-${id}` }), dedupe_key: `shop_quote:${id}`,
  });
  await audit('shop_quote_request', { actor, detail: `enquiry #${id}, ${lines.length} lines` });
  return NextResponse.json({ ok: true, enquiry: id });
}
