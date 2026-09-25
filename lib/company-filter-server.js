// lib/company-filter-server.js — server side of the company selector (reads the cookie).
import { cookies } from 'next/headers';
import { COMPANY_COOKIE, parseCompany } from '@/lib/company-filter.mjs';

export function getSelectedCompany() {
  return parseCompany(cookies().get(COMPANY_COOKIE)?.value);
}
