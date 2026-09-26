// lib/company-filter.mjs — the global company selector (All / Shanti Boilers / Shanti Techno Fab).
// Stored in the `company` cookie ('' = All). Pure helpers, safe on server and client.
import { COMPANY_NAMES } from './company-profiles.js';

export const COMPANY_COOKIE = 'company';

// Cookie value -> a real company name, or null for "All" / anything unknown.
export function parseCompany(v) {
  const s = decodeURIComponent(String(v ?? ''));
  return COMPANY_NAMES.includes(s) ? s : null;
}

// Rows older than the company column (or left blank) belong to the default letterhead company.
export function rowCompany(row) { return row?.company || COMPANY_NAMES[0]; }

// Short tag for a row's company (SB / STF) — shown when "All companies" is selected.
export function companyShort(row) { return rowCompany(row).split(/\s+/).map(w => w[0]).join('').toUpperCase(); }

export function filterByCompany(rows, company) {
  return company ? (rows || []).filter(r => rowCompany(r) === company) : rows;
}

// Who sees the selector. It narrows Sales screens only (/sales and the Sales reports on /reports).
export const COMPANY_SELECTOR_DEPTS = ['Sales', 'Marketing', 'Accounts'];
export function canUseCompanySelector(user) {
  if (!user) return false;
  if (['admin', 'manager', 'executive'].includes(user.role)) return true;
  const depts = Array.isArray(user.departments) ? user.departments : String(user.departments || '').split(',').map(d => d.trim());
  return COMPANY_SELECTOR_DEPTS.some(d => depts.includes(d));
}

// A page's company list (for its own company buttons) narrowed to the selected company.
export function narrowCompanies(companies, company) {
  return company ? (companies || []).filter(c => c.company === company) : companies;
}

// Client: current selection from document.cookie (null = All).
export function selectedCompanyClient() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)company=([^;]*)/);
  return m ? parseCompany(m[1]) : null;
}

// Default for a new record: the selected company, else the first one.
export function defaultCompanyClient() { return selectedCompanyClient() || COMPANY_NAMES[0]; }
