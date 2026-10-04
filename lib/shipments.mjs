// Shipment = several packing lists (usually of different projects) that leave together to the same
// place on one truck. The lists keep their own PL numbers, approvals and e-way bills; a shipment only
// groups them under its own id (SHP-xxxx) so they can be printed, given one vehicle and split up again.
// Pure rules shared by the overlay (client) and the API (server).
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// lists: [{ packing_no, customer_name, customer_address, status, shipment_id, company }]
// existingShipmentId: set when adding to a shipment that already exists (its own lists are fine).
export function checkCombinable(lists, existingShipmentId = null) {
  const problems = []; const warnings = [];
  if (lists.length < 2) problems.push('Pick at least two packing lists.');
  for (const l of lists) {
    if (l.status === 'dispatched') problems.push(`${l.packing_no} is already dispatched.`);
    if (l.shipment_id && l.shipment_id !== existingShipmentId) problems.push(`${l.packing_no} is already in another shipment.`);
  }
  const addrs = new Set(lists.map(l => norm(l.customer_address)).filter(Boolean));
  const names = new Set(lists.map(l => norm(l.customer_name)).filter(Boolean));
  const allHaveAddr = lists.every(l => norm(l.customer_address));
  if (addrs.size > 1) problems.push('These lists have different delivery addresses.');
  else if (names.size > 1 && !(allHaveAddr && addrs.size === 1)) problems.push('These lists are for different customers and no common address is filled in.');
  if (!allHaveAddr && addrs.size <= 1 && names.size <= 1) {
    const missing = lists.filter(l => !norm(l.customer_address)).map(l => l.packing_no);
    if (missing.length) warnings.push(`No address on ${missing.join(', ')}. Matched by customer name only.`);
  }
  if (new Set(lists.map(l => l.company || '')).size > 1) warnings.push('Different companies. Each list keeps its own invoice and e-way bill.');
  return { ok: problems.length === 0, problems, warnings };
}
