// lib/use-company-default.js — a report/ledger card's own company buttons start on the company
// picked in the top-bar selector (falls back to the first company). Starts on the first company and
// switches after mount, so server and client render the same first frame (no hydration mismatch).
import { useEffect, useState } from 'react';
import { selectedCompanyClient } from './company-filter.mjs';

export function useCompanyDefault(companies, key = 'company') {
  const [value, setValue] = useState(companies[0]?.[key]);
  useEffect(() => {
    const sel = selectedCompanyClient();
    const match = sel && companies.find(c => c.company === sel);
    if (match) setValue(match[key]);
    // Run once on mount: later changes are the user's own clicks on the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [value, setValue];
}
