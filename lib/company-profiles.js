// lib/company-profiles.js — the deployment's legal entities as documents and dropdowns see them.
// The data lives in the company_settings table (Accounts → Company Entities); this file only holds
// an in-memory copy so the ~90 callers can stay synchronous:
//   server: lib/db.js fills it after migrate() and after every company-settings write (refreshCompanies)
//   browser: app/layout.js writes a light copy (no logo bytes) into an inline script before hydration
// Kept on globalThis because `next dev` gives every route its own copy of this module.
// ponytail: one server process assumed. On several instances an edit reaches the others only on
// restart; add a timed reload in lib/db.js if the app is ever scaled out.
const store = (globalThis.__sbCompanies ??= { names: [], profiles: {} });

// Names in company_settings id order. The first one is the default for records with no company.
export const COMPANY_NAMES = store.names;
export const COMPANY_PROFILES = store.profiles;

const join = parts => parts.filter(Boolean).join(' · ');

// One company_settings row -> what documents print. `row._logo` (data URI) is attached by the server loader.
export function buildProfile(row) {
  const address = row.registered_address || '';
  return {
    company: row.company,
    name: row.print_name || String(row.legal_name || row.company || '').toUpperCase(),
    sub: join([address, row.gstin && `GST: ${row.gstin}`, row.phone && `Ph: ${row.phone}`]),
    address, gstin: row.gstin || '', phone: row.phone || '',
    prefix: row.invoice_prefix || '',
    storesEmail: row.stores_email || '',
    tagline: row.tagline || '', motto: row.motto || '', tm: row.wordmark_tm === '1' || row.wordmark_tm === 1,
    docHeaders: row.doc_headers_json || '',
    poTerms: row.po_terms_json || '',
    logo: row._logo || null, logoW: row.logo_w || null, logoH: row.logo_h || null,
    // QC statutory folder identity (name/address may differ from the commercial letterhead).
    qc: {
      name: row.qc_name || row.legal_name || row.company || '',
      address: row.qc_address || address,
      refPrefix: row.qc_ref_prefix || (row.invoice_prefix ? `${row.invoice_prefix}/QC/OW` : 'QC/OW'),
      docPrefix: row.qc_doc_prefix || row.invoice_prefix || '',
      makerPrefix: row.maker_prefix || '',
      contact: {
        mobile: row.contact_mobile || '', landline: row.contact_landline || '', whatsapp: row.contact_whatsapp || '',
        emails: String(row.contact_emails || '').split(',').map(s => s.trim()).filter(Boolean),
        website: row.website || '',
      },
    },
  };
}

// Replace the cache in place (callers hold references to the same array/object).
export function setCompanies(rows) {
  store.names.length = 0;
  for (const k of Object.keys(store.profiles)) delete store.profiles[k];
  for (const row of rows || []) {
    store.names.push(row.company);
    store.profiles[row.company] = row.name !== undefined && row.sub !== undefined ? row : buildProfile(row);
  }
}

export function defaultCompany() { return COMPANY_NAMES[0] || ''; }
// Short code of the default company — the letters in PO / project / report numbers.
export function defaultPrefix() { return COMPANY_PROFILES[COMPANY_NAMES[0]]?.prefix || 'CO'; }

const EMPTY = buildProfile({});
export function companyProfile(company) {
  return COMPANY_PROFILES[company] || COMPANY_PROFILES[COMPANY_NAMES[0]] || { ...EMPTY, company: company || '', name: String(company || '').toUpperCase() };
}

// What the browser needs: no logo bytes, no contacts it doesn't show.
export function clientCompanies() {
  return COMPANY_NAMES.map(n => { const { logo, ...rest } = COMPANY_PROFILES[n]; return rest; });
}
