// lib/sales-links.mjs — pure helpers for scripts/enrich-sales-links.mjs: read a pincode, State and city
// out of an address, and pick a unique record to link. No DB import. Nothing here guesses: when a
// value can't be read with confidence it returns null and the caller lists it for review.

export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Chandigarh', 'Puducherry', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'];
const ALIASES = { orissa: 'Odisha', uttaranchal: 'Uttarakhand', pondicherry: 'Puducherry', 'new delhi': 'Delhi', 'jammu & kashmir': 'Jammu and Kashmir', 'j&k': 'Jammu and Kashmir',
  'andra pradesh': 'Andhra Pradesh', maharastra: 'Maharashtra', 'andaman nicobar': 'Andaman and Nicobar Islands', 'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu' }; // includes spellings found in the old CRM data
const stateKey = new Map([...STATES.map(s => [s.toLowerCase(), s]), ...Object.entries(ALIASES)]);
export const canonicalState = v => stateKey.get(String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) || null;

// First two pincode digits that belong to ONE state. Left out on purpose (mixed states): 16, 24, 26, 40, 60, 79, 81, 83-85.
const PIN2 = { 11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab', 17: 'Himachal Pradesh', 18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir',
  20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh', 23: 'Uttar Pradesh', 25: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh',
  30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan', 36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
  41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra', 45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh',
  49: 'Chhattisgarh', 50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh', 56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
  61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu', 67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
  70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal', 75: 'Odisha', 76: 'Odisha', 77: 'Odisha', 78: 'Assam', 80: 'Bihar', 82: 'Uttar Pradesh' };
delete PIN2[82]; // 82x is Bihar/Jharkhand/UP border — not unique
export const stateFromPin = pin => PIN2[String(pin ?? '').slice(0, 2)] || null;

const PIN = /(?<!\d)([1-9]\d{5})(?!\d)/;
const STATE_RE = new RegExp(`(?:^|[,\\s])(${[...STATES, ...Object.keys(ALIASES)].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[,\\s\\d])`, 'i');
const cityOk = c => !!c && c.split(/\s+/).length <= 4 && /^[A-Za-z][A-Za-z .()'-]*$/.test(c) && !/\b(plot|no|road|street|nagar|colony|floor|near|opp|behind|po|dist|district|industrial|estate|village|mandal|ward)\b/i.test(c);

// "silambinathanpettai, Cuddalore, Tamil Nadu, 607102 ALL" -> { pin:'607102', state:'Tamil Nadu', city:'Cuddalore' }
// The city is only taken from the "City, State" tail; the state from the text, else (marked derived) from the pincode.
export function parseAddress(raw) {
  const a = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!a) return { pin: null, state: null, city: null, derived: false };
  const pin = (a.match(PIN) || [])[1] || null;
  const segs = a.replace(/\b(ALL)\s*$/i, '').split(',').map(s => s.trim()).filter(Boolean);
  let state = null, city = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = STATE_RE.exec(segs[i]);
    if (m && canonicalState(m[1])) { state = canonicalState(m[1]); const before = segs[i].slice(0, m.index).trim(); const c = before || segs[i - 1]; if (cityOk(c)) city = c.replace(/\s+/g, ' '); break; }
  }
  if (!state && pin && stateFromPin(pin)) return { pin, state: stateFromPin(pin), city: null, derived: true };
  return { pin, state, city, derived: false };
}

// Contact name at the start of the "Contact Person" cell ("Kanu Patra\n Mob. No. …"), else null.
export function contactNameFromCell(cell) {
  const pre = String(cell ?? '').split(/\n|Mob\. No\.|Tel\. No\.|Email Id/)[0].replace(/\s+/g, ' ').trim();
  return pre.length > 2 && !/\d{4}/.test(pre) && !pre.includes('@') ? pre : null;
}

// "9876543210" from any phone-ish text (last 10 digits when 10+ digits).
export const last10 = v => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
export const emailsOf = v => [...new Set(String(v ?? '').toLowerCase().split(/[\s,;]+/).filter(e => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(e)))];

// Index customers by email and by 10-digit phone -> lookup(email, phone) = customer only when exactly one matches.
export function contactIndex(customers) {
  const byEmail = new Map(), byPhone = new Map();
  const put = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
  for (const c of customers) { for (const e of emailsOf(c.email)) put(byEmail, e, c.id); for (const p of String(c.phone ?? '').split(/[,;/]/)) put(byPhone, last10(p), c.id); }
  const one = s => (s && s.size === 1 ? [...s][0] : null);
  return (email, phone) => {
    const byE = emailsOf(email).map(e => byEmail.get(e)).filter(Boolean), byP = byPhone.get(last10(phone));
    const e = byE.length === 1 ? one(byE[0]) : null, p = one(byP);
    if (e && p && e !== p) return { id: null, why: 'email and phone point at different customers' };
    if (e || p) return { id: e || p, how: e ? 'email' : 'phone' };
    return { id: null, why: byE.length || byP ? 'shared by several customers' : 'no match' };
  };
}

// Days between two ISO dates.
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// Pick the single enquiry a document belongs to: same customer, enquiry dated no more than `slack` days
// after the document and no more than `window` days before it. Exactly one candidate, else null + why.
export function uniqueEnquiry(candidates, docDate, { window = 365, slack = 7 } = {}) {
  const c = candidates.filter(l => l.enquiry_date && (d => d >= -slack && d <= window)(daysBetween(l.enquiry_date, docDate)));
  if (c.length === 1) return { lead: c[0] };
  return { lead: null, why: c.length ? `${c.length} enquiries fit` : candidates.length ? 'no enquiry within the window' : 'no enquiry for this customer' };
}
