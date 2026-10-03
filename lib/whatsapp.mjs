// lib/whatsapp.mjs — pure parts of the WhatsApp (Meta Cloud API) integration: reading Meta's webhook
// payload, the 24-hour reply rule, the webhook signature, and template text. No DB, no network.
//   node lib/whatsapp-selfcheck.mjs
import crypto from 'crypto';

export const GRAPH = 'https://graph.facebook.com/v25.0';
export const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);

// India-first: a 10-digit number gets 91 in front; anything longer is taken as already international.
export function toWaId(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, '');
}

// Text shown in the thread for each kind of incoming message (media itself is not downloaded).
function bodyOf(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[reply]';
    case 'image': return `[photo]${m.image?.caption ? ` ${m.image.caption}` : ''}`;
    case 'document': return `[document${m.document?.filename ? `: ${m.document.filename}` : ''}]${m.document?.caption ? ` ${m.document.caption}` : ''}`;
    case 'audio': return '[voice message]';
    case 'video': return `[video]${m.video?.caption ? ` ${m.video.caption}` : ''}`;
    case 'location': return `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(', ')}`.trim();
    case 'contacts': return '[contact card]';
    case 'sticker': return '[sticker]';
    default: return `[${m.type || 'message'}]`;
  }
}

// Meta's webhook body → flat events: { phoneNumberId, messages: [...], statuses: [...] } per change.
export function parseWebhook(payload) {
  const out = [];
  if (payload?.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const names = new Map((v.contacts || []).map(c => [c.wa_id, c.profile?.name || null]));
      out.push({
        phoneNumberId,
        messages: (v.messages || []).map(m => ({
          waMessageId: m.id, from: m.from, name: names.get(m.from) || null, type: m.type || 'text', body: bodyOf(m),
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
        })),
        statuses: (v.statuses || []).map(s => ({
          waMessageId: s.id, status: s.status,
          error: s.errors?.[0] ? (s.errors[0].error_data?.details || s.errors[0].title || s.errors[0].message || 'failed') : null,
        })),
      });
    }
  }
  return out;
}

// Free-form replies are only allowed within 24 hours of the customer's last message; after that
// WhatsApp only accepts an approved template. lastInboundAt: 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO.
export function windowOpen(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return false;
  const t = Date.parse(String(lastInboundAt).includes('T') ? lastInboundAt : `${String(lastInboundAt).replace(' ', 'T')}Z`);
  return Number.isFinite(t) && now - t < 24 * 3600e3;
}

// X-Hub-Signature-256: "sha256=<HMAC-SHA256 of the raw body with the app secret>".
export function signatureOk(rawBody, header, appSecret) {
  if (!appSecret) return true; // no secret saved: the verify token + unguessable phone id are the only checks
  const want = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(String(header || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// An approved template's body text and how many {{n}} values it needs.
export function templateInfo(t) {
  const body = (t.components || []).find(c => c.type === 'BODY')?.text || '';
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  const header = (t.components || []).find(c => c.type === 'HEADER')?.format || null; // 'DOCUMENT' when the template carries a PDF
  return { name: t.name, language: t.language, category: t.category, body, header, params: nums.length ? Math.max(...nums) : 0 };
}
export const fillTemplate = (body, params = []) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');

// pricing_analytics data_points → { cost, messages, free (not charged), byCategory: [{category, cost, messages}] }.
export function sumUsage(dataPoints = []) {
  const by = new Map();
  let free = 0;
  for (const p of dataPoints) {
    const k = p.pricing_category || 'OTHER';
    const e = by.get(k) || { category: k, cost: 0, messages: 0 };
    e.cost += Number(p.cost) || 0; e.messages += Number(p.volume) || 0; by.set(k, e);
    if (/^FREE/.test(p.pricing_type || '')) free += Number(p.volume) || 0;
  }
  const byCategory = [...by.values()].sort((a, b) => b.cost - a.cost);
  return { cost: byCategory.reduce((n, e) => n + e.cost, 0), messages: byCategory.reduce((n, e) => n + e.messages, 0), free, byCategory };
}
