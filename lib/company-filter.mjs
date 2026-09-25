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

// Who sees the selector — and so whose pages it narrows. PMs, plus heads of the departments whose
// screens hold company-owned records (orders, invoices, payments, POs, bills, packing lists). Other
// departments (Design, Production, QC …) never get filtered by a cookie they can't see or change.
export const COMPANY_SELECTOR_DEPTS = ['Sales', 'Marketing', 'Accounts', 'Procurement', 'Dispatch'];
export function canUseCompanySelector(user) {
  if (!user) return false;
  if (['admin', 'manager', 'executive'].includes(user.role)) return true;
  const depts = Array.isArray(user.departments) ? user.departments : String(user.departments || '').split(',').map(d => d.trim());
  return COMPANY_SELECTOR_DEPTS.some(d => depts.includes(d));
}

// Client: current selection from document.cookie (null = All).
export function selectedCompanyClient() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)company=([^;]*)/);
  return m ? parseCompany(m[1]) : null;
}

// Default for a new record: the selected company, else the first one.
export function defaultCompanyClient() { return selectedCompanyClient() || COMPANY_NAMES[0]; }
