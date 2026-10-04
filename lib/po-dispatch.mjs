// Validation of a supplier's dispatch against an issued PO (pure: no database). Shared by the supplier
// link, the Procurement screen and the API.
import { cleanTrackingUrl, TRANSPORT_MODES } from './carrier.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_FIELDS = ['dispatch_through', 'vehicle_no', 'carrier_doc_no', 'container_no', 'invoice_no', 'eway_bill_no', 'notes'];
const DATE_FIELDS = ['dispatched_on', 'carrier_doc_date', 'expected_delivery_date', 'invoice_date'];

// balances: Map(po_item_id -> { remaining, description }). Returns { error } or { values, items }.
export function validateDispatch(body, balances, { requireItems = true } = {}) {
  const v = {};
  for (const f of DATE_FIELDS) {
    const s = String(body[f] ?? '').trim();
    if (s && !DATE.test(s)) return { error: 'Dates must be in the form YYYY-MM-DD' };
    v[f] = s || null;
  }
  if (!v.dispatched_on) return { error: 'Enter the date the goods were dispatched' };
  for (const f of TEXT_FIELDS) {
    const s = String(body[f] ?? '').trim();
    if (s.length > 300) return { error: 'One of the fields is too long' };
    v[f] = s || null;
  }
  v.transport_mode = TRANSPORT_MODES.some(([k]) => k === body.transport_mode) ? body.transport_mode : null;
  const t = cleanTrackingUrl(body.tracking_url);
  if (t.error) return { error: t.error };
  v.tracking_url = t.value;

  let items = null;
  if (body.items !== undefined || requireItems) {
    const raw = Array.isArray(body.items) ? body.items : [];
    const seen = new Set(); items = [];
    for (const it of raw) {
      const id = Number(it.po_item_id), qty = Number(it.qty);
      if (!(qty > 0)) continue;                       // a line left at 0 is simply not on this truck
      const bal = balances.get(id);
      if (!bal) return { error: 'One of the lines is not on this order' };
      if (seen.has(id)) return { error: 'A line appears twice' };
      if (qty > bal.remaining + 1e-9) return { error: `${bal.description}: only ${bal.remaining} left to dispatch` };
      seen.add(id); items.push({ po_item_id: id, qty });
    }
    if (!items.length) return { error: 'Tick at least one line with a quantity' };
  }
  return { values: v, items };
}

// Files on a dispatch: up to 3, photos or PDF, 8 MB each.
export const DISPATCH_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const DISPATCH_FILE_MAX = 3;
export const DISPATCH_FILE_BYTES = 8 * 1024 * 1024;
