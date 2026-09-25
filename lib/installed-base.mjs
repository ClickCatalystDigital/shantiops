// lib/installed-base.mjs — Sales CRM plan 4. Warranty window for one item a customer bought.
// The period is the accepted warranty (else the standard one) in days, counted from delivery
// (from_date_of 'D') or installation ('I'). Delivery/installation dates come from the order's
// project (dispatch / commissioning); until that date exists the warranty hasn't started.
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function warrantyWindow(item, { deliveredOn = null, installedOn = null } = {}, today) {
  const days = Number(item?.warranty_accepted_days) || Number(item?.warranty_std_days) || 0;
  if (!days) return { status: 'none', days: 0, start: null, end: null };
  const basis = item.from_date_of === 'I' ? 'installation' : 'delivery';
  const start = (basis === 'installation' ? installedOn : deliveredOn)?.slice(0, 10) || null;
  if (!start) return { status: 'not_started', days, basis, start: null, end: null };
  const end = addDays(start, days);
  return { status: end < today ? 'expired' : 'active', days, basis, start, end, daysLeft: Math.round((Date.parse(end) - Date.parse(today)) / 86400000) };
}
