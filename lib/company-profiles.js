// lib/company-profiles.js — the two legal entities' identity blocks (name/address/GSTIN), used by
// every generated PDF's header and by ~20 API routes to validate `company` params. Extracted out of
// lib/qc-doc-pdf.js (still re-exported there for backward compatibility) so pure data/no-JSX
// consumers — lib/report-pdf.js and its self-check, which run under plain `node` — don't have to
// import a JSX file to get it.
//
// V2-CHANGES.md Group 2 — two companies (client point 1). Default ('Shanti Boilers') reproduces the
// exact pre-existing header/signatory text byte-for-byte, so every document that predates this
// column (or was never explicitly set) renders unchanged. Shanti Techno Fab's legal name/address/
// GSTIN are sourced from the client's own Vendor party master (V2-CHANGES.md Group 3 — STF is a
// real vendor in Shanti Boilers' own books), client-confirmed 2026-08-04. No phone number on file
// for STF yet — omitted rather than guessed; add it here once known. Neither company has a logo —
// text-only for both (client-confirmed).
export const COMPANY_PROFILES = {
  'Shanti Boilers': {
    name: 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD',
    sub: 'P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164',
  },
  'Shanti Techno Fab': {
    name: 'SHANTI TECHNO FAB PVT LTD',
    sub: 'Survey No. 128/E3, Kuncharam Village, Toopran Mandal, Medak, Telangana - 502336 · GST: 36AAVCS1802J1Z1',
  },
};

export function companyProfile(company) {
  return COMPANY_PROFILES[company] || COMPANY_PROFILES['Shanti Boilers'];
}

// Single source of truth for "which companies does this build know about" — projects.company and
// qc_documents.company both validate against this instead of each keeping their own copy.
export const COMPANY_NAMES = Object.keys(COMPANY_PROFILES);
