'use client';

// components/CompanySelector.jsx — global company filter in the top bar (All / Shanti Boilers /
// Shanti Techno Fab). Saves the `company` cookie (1 year) and refreshes, so server pages re-read it.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { selectedCompanyClient } from '@/lib/company-filter.mjs';

export default function CompanySelector() {
  const router = useRouter();
  const [value, setValue] = useState('all');
  useEffect(() => { setValue(selectedCompanyClient() || 'all'); }, []);
  function pick(v) {
    setValue(v);
    document.cookie = `company=${v === 'all' ? '' : encodeURIComponent(v)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  return (
    <Select value={value} onValueChange={pick}>
      <SelectTrigger className="h-8 w-auto max-w-44 gap-1 text-xs" aria-label="Company"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All companies</SelectItem>
        {COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
