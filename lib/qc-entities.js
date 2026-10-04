// lib/qc-entities.js — which legal entity a QC statutory folder is filed under, and who it is sent to.
// The entity follows the maker's number: the company whose "Maker's number prefix" (Accounts →
// Company Entities → Documents) starts it; otherwise the document's own company; otherwise the default.
// Name, address, contacts, reference prefix and logo all come from lib/company-profiles.js.
import { COMPANY_NAMES, COMPANY_PROFILES, companyProfile } from './company-profiles.js';
import { CUSTOMER_SEED } from './customer-seed.js';

export function entityForMaker(makerNo, company) {
  const maker = String(makerNo || '').toUpperCase();
  const byPrefix = COMPANY_NAMES.map(n => COMPANY_PROFILES[n])
    .filter(p => p.qc.makerPrefix && maker.startsWith(p.qc.makerPrefix.toUpperCase()))
    .sort((a, b) => b.qc.makerPrefix.length - a.qc.makerPrefix.length)[0];
  const p = byPrefix || companyProfile(company);
  // An entity with no logo of its own prints the default company's (one brand across the group, as before).
  const lp = p.logo ? p : companyProfile();
  return { ...p.qc, logo: lp.logo, logoW: lp.logoW, logoH: lp.logoH, makerPrefixes: COMPANY_NAMES.map(n => COMPANY_PROFILES[n].qc.makerPrefix).filter(Boolean) };
}

// Default covering-letter recipient (a folder can override it). `address` is an array of lines.
// Comes from the customer seed: it is the statutory authority for this deployment's state.
export const QC_AUTHORITY = CUSTOMER_SEED.qcAuthority || { name: '', address: [], designation: '' };
