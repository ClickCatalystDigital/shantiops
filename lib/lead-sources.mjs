// lib/lead-sources.mjs — marketplace / form lead sources (Marketing → Lead sources). Pure: turns each
// source's raw record into one shape the ingester (lib/lead-ingest.js) understands, plus the request
// details for the pull APIs. Field names come from each provider's published API; anything missing is
// simply left blank (never invented).
//   node lib/lead-sources-selfcheck.mjs

// kind: 'pull' = we fetch on a timer (min interval in minutes); 'push' = the provider calls our URL.
export const LEAD_SOURCES = {
  indiamart: { label: 'IndiaMART', kind: 'pull', everyMin: 5,
    fields: [{ key: 'crm_key', label: 'CRM key', hint: 'Lead Manager → Import/Export Leads → CRM API key (IndiaMART emails it).' }] },
  tradeindia: { label: 'TradeIndia', kind: 'pull', everyMin: 15,
    fields: [
      { key: 'userid', label: 'User ID', hint: 'My Profile → Inquiries & Contacts → My Inquiry API.' },
      { key: 'profile_id', label: 'Profile ID' },
      { key: 'key', label: 'API key' },
    ] },
  justdial: { label: 'JustDial', kind: 'push', fields: [],
    howTo: 'Send this address to your JustDial account manager and ask them to push leads to it. JustDial has no self-serve screen for this.' },
  webform: { label: 'Website / other forms', short: 'Website', kind: 'push', fields: [],
    howTo: 'Point your website enquiry form (or Google Ads lead form, Zapier, etc.) at this address. Send JSON or form fields: name, company, phone, email, city, product, message.' },
};

const clean = v => { const s = String(v ?? '').trim(); return s && s.toLowerCase() !== 'null' ? s : ''; };
export const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);

// IST timestamp "DD-MM-YYYYHH:MM:SS" (IndiaMART's documented format).
export function indiamartTime(date) {
  const d = new Date(date.getTime() + 5.5 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Window to ask for: from the last successful pull (minus a 10-minute overlap — the dedupe table makes
// repeats harmless) to now, never more than 7 days (IndiaMART's limit) and 24 h on the first run.
export function pullWindow(lastSuccess, now = new Date(), maxDays = 7) {
  const max = maxDays * 24 * 3600e3;
  let from = lastSuccess ? new Date(new Date(lastSuccess).getTime() - 10 * 60e3) : new Date(now.getTime() - 24 * 3600e3);
  if (now - from > max) from = new Date(now.getTime() - max);
  return { from, to: now };
}

// "2026-10-03 14:22:05" or "03-Oct-2026 ..." → YYYY-MM-DD (else null).
function isoDate(s) {
  const t = clean(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function shape(o) {
  return {
    externalId: clean(o.externalId), person: clean(o.person), organization: clean(o.organization),
    phone: clean(o.phone), email: clean(o.email), address: clean(o.address), city: clean(o.city),
    state: clean(o.state), pin: clean(o.pin), product: clean(o.product), message: clean(o.message),
    enquiryDate: isoDate(o.date),
  };
}

export function mapIndiaMart(r) {
  return shape({
    externalId: r.UNIQUE_QUERY_ID, person: r.SENDER_NAME, organization: r.SENDER_COMPANY,
    phone: r.SENDER_MOBILE || r.SENDER_PHONE || r.SENDER_MOBILE_ALT, email: r.SENDER_EMAIL || r.SENDER_EMAIL_ALT,
    address: r.SENDER_ADDRESS, city: r.SENDER_CITY, state: r.SENDER_STATE, pin: r.SENDER_PINCODE,
    product: r.QUERY_PRODUCT_NAME || r.QUERY_MCAT_NAME || r.SUBJECT, message: r.QUERY_MESSAGE, date: r.QUERY_TIME,
  });
}

export function mapTradeIndia(r) {
  return shape({
    externalId: r.rfi_id, person: r.sender_name, organization: r.sender_co,
    phone: r.sender_mobile || r.sender_other_mobiles, email: r.sender_email || r.sender_other_emails,
    address: r.address, city: r.sender_city, state: r.sender_state, pin: r.sender_pincode,
    product: r.product_name || r.subject, message: r.message, date: r.generated_date,
  });
}

// JustDial's push uses lowercase keys (leadid, name, mobile, email, company, city, area, pincode,
// category, date). Form posts and JSON both arrive here as a plain object.
export function mapJustDial(r) {
  return shape({
    externalId: r.leadid || r.lead_id, person: r.name, organization: r.company,
    phone: r.mobile || r.phone, email: r.email, address: [r.area, r.brancharea].filter(Boolean).join(', '),
    city: r.city, pin: r.pincode, product: r.category, message: r.message || r.leadtype, date: r.date,
  });
}

// Generic form: name/company/phone/email/city/state/pincode/product/message (+ optional id).
export function mapWebform(r) {
  return shape({
    externalId: r.id || r.lead_id || r.submission_id, person: r.name || r.full_name, organization: r.company || r.organization,
    phone: r.phone || r.mobile || r.phone_number, email: r.email, address: r.address, city: r.city, state: r.state,
    pin: r.pincode || r.pin_code || r.zip, product: r.product, message: r.message || r.comments, date: r.date,
  });
}

export const MAPPERS = { indiamart: mapIndiaMart, tradeindia: mapTradeIndia, justdial: mapJustDial, webform: mapWebform };

// A lead worth creating needs a way to reach someone.
export const usable = l => !!(l.phone || l.email);
