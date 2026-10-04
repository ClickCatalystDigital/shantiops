// Carrier / tracking details of a consignment, kept as plain business records (no tracking service yet).
// The document name follows the mode of transport: road LR, rail RR, ship BL, air AWB.
// Shared by the Dispatch screens, the shipment card and the supplier portal.
export const TRANSPORT_MODES = [['road', 'Road'], ['rail', 'Rail'], ['air', 'Air'], ['ship', 'Ship']];
const DOC = { road: ['LR no.', 'LR'], rail: ['RR no.', 'RR'], ship: ['Bill of lading no.', 'BL'], air: ['Air waybill no.', 'AWB'] };
export const carrierDocLabel = mode => (DOC[mode] || DOC.road)[0];
export const carrierDocShort = mode => (DOC[mode] || DOC.road)[1];
export const CARRIER_FIELDS = ['transport_mode', 'dispatch_through', 'vehicle_no', 'carrier_doc_no', 'carrier_doc_date', 'container_no', 'tracking_url', 'expected_delivery_date'];

// Only web links are kept: a tracking link is rendered as an anchor, so "javascript:" and the like are refused.
export function cleanTrackingUrl(v) {
  const s = String(v || '').trim();
  if (!s) return { value: null };
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return { error: 'The tracking link must start with http:// or https://' };
  return { value: s };
}

// One line for lists and cards, e.g. "LR 4451 · ABC Transport · TS09 UB 1234 · due 15 Oct 2026".
export function carrierSummary(c, formatDate) {
  const parts = [];
  if (c.carrier_doc_no) parts.push(`${carrierDocShort(c.transport_mode)} ${c.carrier_doc_no}`);
  if (c.dispatch_through) parts.push(c.dispatch_through);
  if (c.container_no) parts.push(`Container ${c.container_no}`);
  if (c.vehicle_no) parts.push(c.vehicle_no);
  if (c.expected_delivery_date) parts.push(`due ${formatDate ? formatDate(c.expected_delivery_date) : c.expected_delivery_date}`);
  return parts.join(' · ');
}
