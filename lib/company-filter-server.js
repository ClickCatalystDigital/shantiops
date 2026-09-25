// lib/company-filter-server.js — server side of the company selector (reads the cookie).
import { cookies } from 'next/headers';
import { COMPANY_COOKIE, parseCompany, canUseCompanySelector } from '@/lib/company-filter.mjs';

export function getSelectedCompany() {
  return parseCompany(cookies().get(COMPANY_COOKIE)?.value);
}

// The selection, but only for a viewer who can see the selector (null = All for everyone else).
export function getSelectedCompanyFor(user) {
  return canUseCompanySelector(user) ? getSelectedCompany() : null;
}
