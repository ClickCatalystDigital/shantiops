// lib/whatsapp.js — WhatsApp inbox on Meta's Cloud API, called directly (no reseller). One number per
// company; every conversation has one owner (the enquiry's A/C manager, else the next Sales person in
// turn). A Sales member sees their own conversations, the Sales Head and PMs see all and can reassign.
// The access token and app secret are stored encrypted and never returned. Pure parts: lib/whatsapp.mjs.
import { queryAll, queryOne, execute } from './db';
import { decryptSecret } from './crypto';
import { nextAssignee } from './crm';
import { notifyUser, notifyDepartmentHeads } from './notify';
import { GRAPH, last10, toWaId, parseWebhook, signatureOk, windowOpen, templateInfo, fillTemplate, sumUsage } from './whatsapp.mjs';

const digitsSql = col => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;

// One Graph API call. Throws Meta's own message so a wrong token / number reads as what it is.
export async function graph(token, path, { method = 'GET', body } = {}) {
  let res, data;
  try {
    res = await fetch(`${GRAPH}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    data = await res.json();
  } catch (e) { throw new Error(`Could not reach WhatsApp: ${e.message}`); }
  if (!res.ok || data?.error) {
    const e = data?.error || {};
    throw new Error(e.error_user_msg || e.error_data?.details || e.message || `WhatsApp returned ${res.status}`);
  }
  return data;
}
const tokenOf = acc => decryptSecret(acc.token_enc);

// The number's own details — doubles as the connection test.
export const fetchNumber = (token, phoneNumberId) =>
  graph(token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);

// Approved templates (the only thing WhatsApp lets us send outside the 24-hour window). Cached 5 min.
const tplCache = new Map();
export async function listTemplates(acc) {
  const hit = tplCache.get(acc.id);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.list;
  const d = await graph(tokenOf(acc), `${acc.waba_id}/message_templates?fields=name,language,category,status,components&limit=200`);
  const list = (d.data || []).filter(t => t.status === 'APPROVED').map(templateInfo);
  tplCache.set(acc.id, { at: Date.now(), list });
  return list;
}

// This month's spend and message counts. Meta bills the card on the account afterwards — there is no
// prepaid balance to read — so "spent so far this month" is the number to watch.
export async function usage(acc) {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const start = Math.floor((Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600e3) / 1000);
  const end = Math.floor(Date.now() / 1000);
  const fields = `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
  const d = await graph(tokenOf(acc), `${acc.waba_id}?fields=${encodeURIComponent(fields)}`);
  const points = (d.pricing_analytics?.data || []).flatMap(x => x.data_points || []);
  return { currency: d.currency || 'INR', ...sumUsage(points) };
}

// ── Incoming (Meta → /api/whatsapp/webhook) ───────────────────────────────────────────────────────
async function conversationFor(acc, m) {
  const found = await queryOne('SELECT * FROM wa_conversations WHERE account_id = ? AND wa_id = ?', [acc.id, m.from]);
  if (found) return found;
  const p = `%${last10(m.from)}`;
  const lead = await queryOne(
    `SELECT id, account_manager, assigned_to FROM leads WHERE ${digitsSql('phone')} LIKE ? OR ${digitsSql('telephone')} LIKE ?
      ORDER BY (status = 'open') DESC, id DESC LIMIT 1`, [p, p]);
  const customer = await queryOne(`SELECT id FROM customers WHERE ${digitsSql('phone')} LIKE ? ORDER BY id DESC LIMIT 1`, [p]);
  const owner = lead?.account_manager || lead?.assigned_to;
  const ownerOk = owner ? await queryOne('SELECT username FROM users WHERE username = ? AND active = 1', [owner]) : null;
  const assignedTo = ownerOk?.username || await nextAssignee('Sales');
  await execute(
    `INSERT OR IGNORE INTO wa_conversations (account_id, wa_id, contact_name, lead_id, customer_id, assigned_to) VALUES (?, ?, ?, ?, ?, ?)`,
    [acc.id, m.from, m.name, lead?.id || null, customer?.id || null, assignedTo]);
  return queryOne('SELECT * FROM wa_conversations WHERE account_id = ? AND wa_id = ?', [acc.id, m.from]);
}

// rawBody: the exact text Meta sent (needed for the signature). Returns counts; never throws on one bad message.
export async function handleWebhook(rawBody, signature) {
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false, status: 400 }; }
  const out = { received: 0, statuses: 0 };
  for (const ev of parseWebhook(payload)) {
    const acc = await queryOne('SELECT * FROM whatsapp_accounts WHERE phone_number_id = ?', [ev.phoneNumberId]);
    if (!acc || !acc.enabled) continue;
    if (!signatureOk(rawBody, signature, acc.app_secret_enc ? decryptSecret(acc.app_secret_enc) : null)) return { ok: false, status: 401 };

    for (const m of ev.messages) {
      const conv = await conversationFor(acc, m);
      const ins = await execute(
        `INSERT OR IGNORE INTO wa_messages (conversation_id, direction, wa_message_id, type, body, status) VALUES (?, 'in', ?, ?, ?, 'received')`,
        [conv.id, m.waMessageId, m.type, m.body]);
      if (!ins.changes) continue; // Meta retried a message we already have
      await execute(
        `UPDATE wa_conversations SET last_message_at = CURRENT_TIMESTAMP, last_inbound_at = CURRENT_TIMESTAMP, last_text = ?,
           unread = unread + 1, contact_name = COALESCE(?, contact_name) WHERE id = ?`, [m.body.slice(0, 200), m.name, conv.id]);
      out.received++;
      if (conv.unread > 0) continue; // one alert per unread conversation, not one per message
      const note = { kind: 'whatsapp_message', title: `WhatsApp from ${m.name || `+${m.from}`}`, body: m.body.slice(0, 200), dedupe_key: `wa:${m.waMessageId}` };
      const u = conv.assigned_to ? await queryOne('SELECT id FROM users WHERE username = ? AND active = 1', [conv.assigned_to]) : null;
      if (u) await notifyUser(u.id, note); else await notifyDepartmentHeads('Sales', note);
    }
    for (const s of ev.statuses) {
      // sent → delivered → read only moves forward; "failed" always lands (with Meta's reason).
      const r = await execute(
        `UPDATE wa_messages SET status = ?, error = ? WHERE wa_message_id = ? AND direction = 'out'
           AND (? = 'failed' OR CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END < CASE ? WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END)`,
        [s.status, s.error, s.waMessageId, s.status, s.status]);
      out.statuses += r.changes || 0;
    }
  }
  return { ok: true, status: 200, ...out };
}

// ── Outgoing ──────────────────────────────────────────────────────────────────────────────────────
// { text } inside the 24-hour window, or { template: { name, language, params: [] } } any time.
export async function sendMessage(conv, user, { text, template }) {
  const acc = await queryOne('SELECT * FROM whatsapp_accounts WHERE id = ?', [conv.account_id]);
  if (!acc || !acc.enabled) throw new Error('WhatsApp is not connected (Settings → Sales → WhatsApp)');
  let payload, body, tplName = null;
  if (template?.name) {
    const t = (await listTemplates(acc)).find(x => x.name === template.name && x.language === template.language);
    if (!t) throw new Error('That template is not approved on this WhatsApp account');
    const params = (template.params || []).map(v => String(v ?? '').trim());
    if (params.length < t.params || params.slice(0, t.params).some(v => !v)) throw new Error(`This template needs ${t.params} value${t.params === 1 ? '' : 's'}`);
    payload = { type: 'template', template: { name: t.name, language: { code: t.language },
      components: t.params ? [{ type: 'body', parameters: params.slice(0, t.params).map(v => ({ type: 'text', text: v })) }] : [] } };
    body = fillTemplate(t.body, params); tplName = t.name;
  } else {
    body = String(text || '').trim();
    if (!body) throw new Error('Type a message');
    if (!windowOpen(conv.last_inbound_at)) throw new Error('More than 24 hours since the customer last wrote — WhatsApp only allows an approved template now');
    payload = { type: 'text', text: { body } };
  }
  const r = await graph(tokenOf(acc), `${acc.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: conv.wa_id, ...payload } });
  await execute(
    `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, type, body, template_name, status, sent_by) VALUES (?, 'out', ?, ?, ?, ?, 'sent', ?)`,
    [conv.id, r.messages?.[0]?.id || null, payload.type, body, tplName, user.username]);
  await execute('UPDATE wa_conversations SET last_message_at = CURRENT_TIMESTAMP, last_text = ?, unread = 0 WHERE id = ?', [`You: ${body}`.slice(0, 200), conv.id]);
  return { ok: true };
}

// ── Business-initiated send (quotation to a customer, RFQ to a supplier) ──────────────────────────
// The primary path once the company's WhatsApp is connected in Settings. Never throws: returns
// { sent: true } or { sent: false, reason } and the screen then falls back to the wa.me click-send
// (not connected, template not approved yet, Meta refused — e.g. a payment problem).
// Inside the 24-hour window: free text (+ the PDF as a document). Outside it: the approved template
// `templateName`, whose body takes `params` in order; a DOCUMENT header carries the PDF.
export const WA_TEMPLATES = { quotation: 'quotation_offer', rfq: 'rfq_request' };
async function uploadPdf(acc, pdf, filename) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  const res = await fetch(`${GRAPH}/${acc.phone_number_id}/media`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(acc)}` }, body: fd, signal: AbortSignal.timeout(30000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error || !d.id) throw new Error(d.error?.message || `WhatsApp refused the PDF (${res.status})`);
  return d.id;
}
export async function sendBusiness({ company, phone, contactName = null, customerId = null, text, pdf = null, filename = 'document.pdf', templateName, params = [], user }) {
  try {
    const acc = await queryOne('SELECT * FROM whatsapp_accounts WHERE company = ? AND enabled = 1', [company || 'Shanti Boilers']);
    if (!acc) return { sent: false, reason: 'WhatsApp is not connected for this company' };
    const waId = toWaId(phone);
    if (!waId) return { sent: false, reason: 'No phone number on file' };
    let conv = await queryOne('SELECT * FROM wa_conversations WHERE account_id = ? AND wa_id = ?', [acc.id, waId]);
    let payload, body, tplName = null;
    if (conv && windowOpen(conv.last_inbound_at)) {
      body = text;
      payload = pdf ? { type: 'document', document: { id: await uploadPdf(acc, pdf, filename), filename, caption: text.slice(0, 1000) } } : { type: 'text', text: { body: text } };
    } else {
      const t = (await listTemplates(acc)).find(x => x.name === templateName);
      if (!t) return { sent: false, reason: `The WhatsApp template "${templateName}" is not approved on this account yet` };
      const vals = params.slice(0, t.params).map(v => String(v ?? '').replace(/\s+/g, ' ').trim() || '-');
      if (vals.length < t.params) return { sent: false, reason: `The template "${templateName}" needs ${t.params} values` };
      const components = [];
      if (t.header === 'DOCUMENT') {
        if (!pdf) return { sent: false, reason: `The template "${templateName}" needs a PDF` };
        components.push({ type: 'header', parameters: [{ type: 'document', document: { id: await uploadPdf(acc, pdf, filename), filename } }] });
      }
      if (t.params) components.push({ type: 'body', parameters: vals.map(v => ({ type: 'text', text: v })) });
      payload = { type: 'template', template: { name: t.name, language: { code: t.language }, components } };
      body = fillTemplate(t.body, vals); tplName = t.name;
    }
    const r = await graph(tokenOf(acc), `${acc.phone_number_id}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to: waId, ...payload } });
    if (!conv) {
      await execute('INSERT OR IGNORE INTO wa_conversations (account_id, wa_id, contact_name, customer_id, assigned_to) VALUES (?, ?, ?, ?, ?)', [acc.id, waId, contactName, customerId, user.username]);
      conv = await queryOne('SELECT * FROM wa_conversations WHERE account_id = ? AND wa_id = ?', [acc.id, waId]);
    }
    await execute(
      `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, type, body, template_name, status, sent_by) VALUES (?, 'out', ?, ?, ?, ?, 'sent', ?)`,
      [conv.id, r.messages?.[0]?.id || null, payload.type, body, tplName, user.username]);
    await execute('UPDATE wa_conversations SET last_message_at = CURRENT_TIMESTAMP, last_text = ? WHERE id = ?', [`You: ${body}`.slice(0, 200), conv.id]);
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

// Conversations this user may see: all for the Sales Head / PM (scope null), else their own.
export function listConversations(scope) {
  return queryAll(
    `SELECT c.id, c.wa_id, c.contact_name, c.lead_id, c.customer_id, c.assigned_to, c.last_message_at, c.last_inbound_at, c.last_text, c.unread,
            a.company, l.lead_name, cu.name AS customer_name, u.display_name AS assigned_name
       FROM wa_conversations c JOIN whatsapp_accounts a ON a.id = c.account_id
       LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN users u ON u.username = c.assigned_to
      ${scope ? 'WHERE c.assigned_to = ?' : ''} ORDER BY c.last_message_at DESC LIMIT 300`, scope ? [scope] : []);
}
