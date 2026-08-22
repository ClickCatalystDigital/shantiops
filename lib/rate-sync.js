// lib/rate-sync.js — pulls verified rates from the statutory-rates-hub and inserts them locally,
// reusing the exact same insert/patch functions the admin routes use (lib/data.js, lib/payroll.js).
// Requires STATUTORY_RATES_HUB_URL and STATUTORY_RATES_HUB_API_KEY in the environment.
import { execute, queryOne } from './db';
import { insertGstRate, insertVendorTdsRate, insertIncomeTaxSlab, insertProfessionalTaxSlab } from './data';
import { patchStatutoryRates } from './payroll';

const APPLY = {
  gst_rate: insertGstRate,
  vendor_tds_rate: insertVendorTdsRate,
  income_tax_slab: insertIncomeTaxSlab,
  professional_tax_slab: insertProfessionalTaxSlab,
  statutory_rate: patchStatutoryRates
};

export async function syncRatesFromHub() {
  const baseUrl = process.env.STATUTORY_RATES_HUB_URL;
  const apiKey = process.env.STATUTORY_RATES_HUB_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('STATUTORY_RATES_HUB_URL / STATUTORY_RATES_HUB_API_KEY not configured');

  const state = await queryOne('SELECT cursor FROM hub_sync_state WHERE id = 1');
  let cursor = state.cursor;
  let applied = 0;

  const res = await fetch(`${baseUrl}/api/rates/since?cursor=${cursor}`, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  const { rows, nextCursor } = await res.json();

  for (const row of rows) {
    const apply = APPLY[row.category];
    if (!apply) continue; // unknown category — skip rather than crash the whole sync
    await apply(row.payload);
    applied++;
  }

  await execute('UPDATE hub_sync_state SET cursor = ?, last_synced_at = CURRENT_TIMESTAMP WHERE id = 1', [nextCursor]);
  return { pulled: rows.length, applied, cursor: nextCursor };
}
