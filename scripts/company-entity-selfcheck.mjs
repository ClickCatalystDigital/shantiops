// scripts/company-entity-selfcheck.mjs — node scripts/company-entity-selfcheck.mjs
// Pure-function checks for lib/company-entity.mjs. No DB, no fake data written anywhere — the
// Sandbox fixture below is a trimmed copy of the real response captured live against Shanti
// Boilers' actual GSTIN during design (2026-08-22), not invented.
import { strict as assert } from 'node:assert';
import { mapSandboxResponse, diffCompanyEntity, computeApplicability } from '../lib/company-entity.mjs';

// --- mapSandboxResponse: derives state_code/PAN from the GSTIN itself, doesn't trust a separate field ---
{
  const raw = {
    gstin: '36AAECS7382N1ZN', lgnm: 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD',
    tradeNam: 'SHANTI BOILERS & PRESSURE VISSELS PVT LTD', sts: 'Active', dty: 'Regular',
    ctb: 'Private Limited Company', rgdt: '01/07/2017', cxdt: '', lstupdt: '12/11/2025',
    einvoiceStatus: 'Yes', nba: ['Factory / Manufacturing'], adadr: [],
    pradr: { addr: { stcd: 'Telangana' }, ntr: 'Factory / Manufacturing' },
    stj: 'Nacharam', ctj: 'NACHARAM',
  };
  const { trackable, extra } = mapSandboxResponse(raw);
  assert.equal(trackable.state_code, '36');
  assert.equal(trackable.pan, 'AAECS7382N');
  assert.equal(trackable.state, 'Telangana');
  assert.equal(trackable.gst_status, 'Active');
  assert.equal(trackable.gst_taxpayer_type, 'Regular');
  assert.equal(trackable.trade_name, 'SHANTI BOILERS & PRESSURE VISSELS PVT LTD');
  assert.equal(extra.einvoice_status, 'Yes');
  assert.deepEqual(JSON.parse(extra.nature_of_business), ['Factory / Manufacturing']);
}

// --- diffCompanyEntity: the "must not silently overwrite" guarantee -----------------------------
{
  const current = {
    legal_name: 'Shanti Boilers', legal_name_source: 'manual',
    gstin: '36AAECS7382N1ZN', gstin_source: 'sandbox',
    state: '', state_source: null,
    pan: 'AAECS7382N', pan_source: 'sandbox',
    trade_name: null, trade_name_source: null,
    gst_status: 'Active', gst_status_source: 'sandbox',
    gst_taxpayer_type: 'Composition', gst_taxpayer_type_source: null, // unknown provenance, non-empty
    gst_registration_date: '01/07/2017', gst_registration_date_source: 'sandbox',
    gst_constitution: '', gst_constitution_source: null,
  };
  const fetched = {
    legal_name: 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD', // differs from a manual entry
    gstin: '36AAECS7382N1ZN', // unchanged
    state: 'Telangana', // was empty -> new
    pan: 'AAECS7382N', // unchanged
    trade_name: 'SHANTI BOILERS & PRESSURE VISSELS PVT LTD', // was empty -> new
    gst_status: 'Active', // unchanged
    gst_taxpayer_type: 'Regular', // differs, source unknown -> must NOT be auto-safe
    gst_registration_date: '01/07/2017', // unchanged
    gst_constitution: 'Private Limited Company', // was empty -> new
  };
  const diff = diffCompanyEntity(current, fetched);
  const byField = Object.fromEntries(diff.map(d => [d.field, d.status]));

  assert.equal(byField.legal_name, 'manual-conflict', 'a manual correction must never be silently overwritten');
  assert.equal(byField.gstin, 'unchanged');
  assert.equal(byField.state, 'new');
  assert.equal(byField.pan, 'unchanged');
  assert.equal(byField.trade_name, 'new');
  assert.equal(byField.gst_status, 'unchanged');
  assert.equal(byField.gst_taxpayer_type, 'manual-conflict', 'unknown provenance must be treated as conservatively as a manual entry, never as safe-to-overwrite');
  assert.equal(byField.gst_registration_date, 'unchanged');
  assert.equal(byField.gst_constitution, 'new');
}

// --- diffCompanyEntity: a value that was itself set by a prior fetch is safe to refresh again ----
{
  const current = { gst_status: 'Active', gst_status_source: 'sandbox' };
  const fetched = { gst_status: 'Cancelled' };
  const diff = diffCompanyEntity(current, fetched);
  assert.equal(diff.find(d => d.field === 'gst_status').status, 'safe');
}

// --- computeApplicability: below/above threshold, and override never hides the computed value ----
{
  const below = computeApplicability({ activeEmployeeCount: 8, hasActivePtSlabForState: true, overrides: {} });
  assert.equal(below.pf.computed, false);
  assert.equal(below.pf.effective, false);
  assert.equal(below.esi.computed, false);
  assert.equal(below.pt.computed, true);
  assert.equal(below.pt.effective, true);

  const above = computeApplicability({ activeEmployeeCount: 24, hasActivePtSlabForState: true, overrides: {} });
  assert.equal(above.pf.computed, true);
  assert.equal(above.esi.computed, true, '24 >= 10, ESI applies even though PF\'s own 20-employee threshold is a separate number');

  const overridden = computeApplicability({ activeEmployeeCount: 8, hasActivePtSlabForState: true, overrides: { pf: true } });
  assert.equal(overridden.pf.computed, false, 'the computed value must stay visible even when overridden — never collapsed away');
  assert.equal(overridden.pf.override, true);
  assert.equal(overridden.pf.effective, true);
  assert.equal(overridden.esi.override, null, 'an unset override must read as null, not false');
  assert.equal(overridden.esi.effective, overridden.esi.computed);
}

console.log('lib/company-entity.mjs selfcheck: all assertions passed');
