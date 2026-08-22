// lib/rate-sync.js — pulls verified rates from the statutory-rates-hub and inserts them locally,
// reusing the exact same insert/patch functions the admin routes use (lib/data.js, lib/payroll.js).
// Requires STATUTORY_RATES_HUB_URL and STATUTORY_RATES_HUB_API_KEY in the environment.
//
// runRateSyncJob() is the production entry point (app/api/statutory-rates/sync, meant to be called
// daily by a Cloudflare Cron Trigger's Worker) — it wraps syncRatesFromHub() with a heartbeat
// (hub_sync_state.last_run_at/last_status/last_error), so monitoring can tell "the cron isn't
// firing" apart from "the cron fires and keeps failing" even when there's nothing new to pull.
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

// Distinguishes "the hub is unreachable/misbehaving" (retryable, worth a 502 to the caller) from
// an internal error (a bad insert, a DB write failure — still safe to retry given idempotency, but
// not the hub's fault). Real Turso ETIMEDOUT flakiness has already hit this exact pipeline once
// (SYSTEM.md §5af) — status codes matter here because whatever's watching the cron job (Cloudflare
// Worker logs, an uptime check) will alert differently on 502 vs 500.
class HubSyncError extends Error {
  constructor(message) { super(message); this.name = 'HubSyncError'; this.isHubError = true; }
}

// Idempotent, safe to call repeatedly: every insert function it calls dedupes on its natural key
// (lib/data.js), and the cursor only advances once, after the whole batch succeeds — a retry after
// a mid-batch failure just re-applies from where it actually stopped, never duplicates.
export async function syncRatesFromHub() {
  const baseUrl = process.env.STATUTORY_RATES_HUB_URL;
  const apiKey = process.env.STATUTORY_RATES_HUB_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('STATUTORY_RATES_HUB_URL / STATUTORY_RATES_HUB_API_KEY not configured');

  const state = await queryOne('SELECT cursor FROM hub_sync_state WHERE id = 1');
  const cursor = state.cursor;
  let applied = 0;

  let res;
  try {
    res = await fetch(`${baseUrl}/api/rates/since?cursor=${cursor}`, { headers: { 'x-api-key': apiKey } });
  } catch (e) {
    throw new HubSyncError(`Could not reach hub: ${e.message}`);
  }
  if (!res.ok) throw new HubSyncError(`Hub returned ${res.status}`);
  const { rows, nextCursor } = await res.json();

  for (const row of rows) {
    const apply = APPLY[row.category];
    if (!apply) continue; // unknown category — skip rather than crash the whole sync
    // effective_from/effective_to are always top-level fields on the hub's rate_changes row, never
    // inside payload — insertGstRate/insertVendorTdsRate both require effective_from as a param.
    await apply({ ...row.payload, effective_from: row.effective_from, effective_to: row.effective_to });
    applied++;
  }

  await execute('UPDATE hub_sync_state SET cursor = ?, last_synced_at = CURRENT_TIMESTAMP WHERE id = 1', [nextCursor]);

  // Verify: read back what was just written. Cheap, and this pipeline has hit real read-after-write
  // flakiness before (a transient ETIMEDOUT against Turso, SYSTEM.md §5af) — better to fail loudly
  // here than report success on a cursor that didn't actually persist.
  const verify = await queryOne('SELECT cursor FROM hub_sync_state WHERE id = 1');
  if (verify.cursor !== nextCursor) {
    throw new Error(`Post-sync verification failed: cursor is ${verify.cursor}, expected ${nextCursor}`);
  }

  return { pulled: rows.length, applied, cursor: nextCursor };
}

export async function runRateSyncJob() {
  try {
    const result = await syncRatesFromHub();
    await execute(
      "UPDATE hub_sync_state SET last_run_at = CURRENT_TIMESTAMP, last_status = 'success', last_error = NULL WHERE id = 1"
    );
    return result;
  } catch (e) {
    // Best-effort heartbeat write on failure too — a run that fails should still be visible to
    // whatever's polling last_status, not just silently absent. If the DB write itself is what's
    // failing (e.g. the same network flakiness that broke the sync), this can't do much more than
    // try; the original error is what gets rethrown either way.
    try {
      await execute(
        "UPDATE hub_sync_state SET last_run_at = CURRENT_TIMESTAMP, last_status = 'error', last_error = ? WHERE id = 1",
        [String(e.message || e).slice(0, 2000)]
      );
    } catch { /* heartbeat write failed too — original error still propagates below */ }
    throw e;
  }
}

export async function getRateSyncHeartbeat() {
  return queryOne('SELECT cursor, last_synced_at, last_run_at, last_status, last_error FROM hub_sync_state WHERE id = 1');
}
