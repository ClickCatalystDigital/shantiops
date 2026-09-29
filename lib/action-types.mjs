// lib/action-types.mjs — the one list of Sales follow-up Action Types (Diary "Action Type" and
// "Plan Of Action for"), plus a keyword classifier used to tag imported follow-up text.
// Pure, no DB import. 'feedback' is a separate concept (Feedback reports) and is not listed here.
// Stored values stay compatible: call / email / meeting / note were always valid.
export const ACTION_TYPES = [
  { value: 'call', label: 'Phone call' },
  { value: 'message', label: 'WhatsApp / message' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting / visit' },
  { value: 'offer', label: 'Offer / proposal' },
  { value: 'intro', label: 'Introduction' },
  { value: 'status', label: 'Status check' },
  { value: 'note', label: 'Other' },
];
export const ACTION_TYPE_VALUES = ACTION_TYPES.map(t => t.value);
export const actionTypeLabel = v => ACTION_TYPES.find(t => t.value === v)?.label || v || '—';

// Keyword rules. The type whose keyword appears EARLIEST in the text wins ("Spoke to him, will
// send mail" = a call, not an email); ties go to the order below. No keyword = null (never guess).
const RULES = [
  ['offer', /\b(offers?|quotations?|quotes?|proposals?|cif|price list)\b/],
  ['message', /\b(msg(ed)?|messag(e|ed|ing)|whats\s?app|wa|sms|text(ed)?|dear sir|namash?kar|namaskar)\b/],
  ['email', /\b(e-?mail(ed)?|mail(ed)?)\b/],
  ['meeting', /\b(meet(ing)?|met|visit(ed)?|appointment|demo)\b/],
  ['intro', /\b(intro(duc\w*)?|introductory)\b/],
  ['call', /\b(spoke|spoken|call(ed|ing)?|phone|talk(ed)?|discuss(ed)?|conversation|no response|not reachable|switch(ed)? off|not received|not responding|not lifting|not picking|not answering|no incoming|unreachable|ringing|nr|busy)\b/],
  ['status', /\b(status|update|check|reminder|follow ?-?up|courtesy|no requirement|not required|requirement|order received|purchase order|closed|duplicate|looking for|are you looking)\b/],
];
export function classifyActionType(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  let best = null;
  for (const [type, re] of RULES) {
    const m = re.exec(s);
    if (m && (best === null || m.index < best.index)) best = { type, index: m.index };
  }
  return best ? best.type : null;
}
