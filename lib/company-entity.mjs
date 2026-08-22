// lib/company-entity.mjs — Company Entities (2026-08-22). Dependency-free, same precedent as
// lib/ledger.mjs/lib/bank-match.mjs: real branching logic (the refresh-vs-manual diff, PF/ESI/PT
// applicability) lives here with its own selfcheck, never inline in a route.
//
// Architecture rule (confirmed with user): statutory-rates-hub stays a national-statutory-data
// source only. Everything here — a company's own registration facts and their applicability to
// this company's own accounting/payroll — is Shanti Ops' job, never the hub's.

export const TRACKABLE_FIELDS = [
  'legal_name', 'gstin', 'state', 'pan', 'trade_name',
  'gst_status', 'gst_taxpayer_type', 'gst_registration_date', 'gst_constitution',
];

export const EXTRA_FIELDS = [
  'gst_cancellation_date', 'gst_jurisdiction_state', 'gst_jurisdiction_central',
  'gst_last_updated_on_portal', 'einvoice_status', 'nature_of_business', 'additional_business_premises',
];

function norm(v) { return (v ?? '').toString().trim(); }

// Maps a raw Sandbox GSTIN-verify response (statutory-rates-hub's passthrough of
// api.sandbox.co.in's `gst/compliance/public/gstin/search`) onto our column names. GSTIN itself
// encodes state_code (chars 0-1) and PAN (chars 2-11) — derived here rather than trusting a
// separate Sandbox field for either, same "derive from the GSTIN, don't re-ask" precedent §5z
// already used for PAN.
export function mapSandboxResponse(raw) {
  const gstin = raw.gstin || '';
  return {
    trackable: {
      legal_name: raw.lgnm || '',
      gstin,
      state: raw.pradr?.addr?.stcd || '',
      state_code: gstin.slice(0, 2),
      pan: gstin.slice(2, 12),
      trade_name: raw.tradeNam || '',
      gst_status: raw.sts || '',
      gst_taxpayer_type: raw.dty || '',
      gst_registration_date: raw.rgdt || '',
      gst_constitution: raw.ctb || '',
    },
    extra: {
      gst_cancellation_date: raw.cxdt || '',
      gst_jurisdiction_state: raw.stj || '',
      gst_jurisdiction_central: raw.ctj || '',
      gst_last_updated_on_portal: raw.lstupdt || '',
      einvoice_status: raw.einvoiceStatus || '',
      nature_of_business: JSON.stringify(raw.nba || []),
      additional_business_premises: JSON.stringify(raw.adadr || []),
    },
  };
}

// The core "must not silently overwrite" guarantee. For each trackable field, compares the fresh
// Sandbox value against what's currently stored and classifies it:
//   'unchanged'       — nothing to do
//   'new'             — current value is empty; always safe to fill in
//   'safe'            — current value came from a prior fetch (or has no recorded provenance —
//                        treated conservatively as needing confirmation below, never as safe)
//   'manual-conflict' — current value was a human correction; refreshing would clobber it
// `state` covers state+state_code together (they never diverge independently) — a state_code
// mismatch alone (without a state name mismatch) can't happen since both come from the same GSTIN.
export function diffCompanyEntity(current, fetched) {
  return TRACKABLE_FIELDS.map((field) => {
    const currentValue = norm(current[field]);
    const fetchedValue = norm(fetched[field]);
    const currentSource = current[`${field}_source`];
    let status;
    if (currentValue === fetchedValue) status = 'unchanged';
    else if (!currentValue) status = 'new';
    else if (currentSource === 'manual') status = 'manual-conflict';
    else status = 'safe'; // currentSource === 'sandbox', or unset/unknown — still safe: an unset
    // source with a non-empty value shouldn't happen post-migration-backfill, but if it ever does,
    // treating it as 'safe' rather than 'manual-conflict' would risk clobbering an untracked manual
    // entry — so unknown provenance is intentionally NOT lumped in here. See below.
    if (status === 'safe' && currentSource !== 'sandbox') status = 'manual-conflict';
    return { field, current: current[field] ?? null, fetched: fetched[field] ?? null, currentSource: currentSource ?? null, status };
  });
}

// PF/ESI/PT applicability — computed in Shanti Ops from data Shanti Ops already has (employee
// headcount, professional_tax_slabs), never fetched from anywhere and never stored in
// statutory-rates-hub (company-specific applicability, not national statutory data — the
// architecture rule this whole feature is built around).
//
// PF: mandatory once an establishment has >= 20 employees (EPF & MP Act). ESI: mandatory at >= 10
// employees (ESI Act; the wage ceiling that determines which individual employees are covered is
// a separate, already-existing lib/payroll.js concern — this is establishment-level applicability,
// not per-employee coverage). PT: applicable if the state the company is registered in actually
// levies it (has any active professional_tax_slabs row) — Telangana does.
//
// Returns {computed, override, effective} for each — never collapses these into one boolean, so
// the UI can always show *why* (computed vs a human override), not just the final answer.
export function computeApplicability({ activeEmployeeCount, hasActivePtSlabForState, overrides = {} }) {
  const result = {};
  const entries = [
    ['pf', activeEmployeeCount >= 20, `${activeEmployeeCount} active employees ${activeEmployeeCount >= 20 ? '≥' : '<'} 20`],
    ['esi', activeEmployeeCount >= 10, `${activeEmployeeCount} active employees ${activeEmployeeCount >= 10 ? '≥' : '<'} 10`],
    ['pt', !!hasActivePtSlabForState, hasActivePtSlabForState ? 'state levies Professional Tax' : 'no Professional Tax slab for this state'],
  ];
  for (const [key, computed, reason] of entries) {
    const override = overrides[key] === null || overrides[key] === undefined ? null : !!overrides[key];
    result[key] = { computed, reason, override, effective: override === null ? computed : override };
  }
  return result;
}
