'use client';

// components/CompanySelector.jsx — global company filter in the top bar (All / Shanti Boilers /
// Shanti Techno Fab). Saves the `company` cookie (1 year) and refreshes, so server pages re-read it.
// The refresh runs in a transition so the control shows it's working — heavy pages (/sales) take a
// few seconds to re-render, and a silent refresh read as "nothing changed".
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2Icon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { selectedCompanyClient } from '@/lib/company-filter.mjs';

export default function CompanySelector() {
  const router = useRouter();
  const [value, setValue] = useState('all');
  const [pending, startTransition] = useTransition();
  useEffect(() => { setValue(selectedCompanyClient() || 'all'); }, []);
  function pick(v) {
    setValue(v);
    document.cookie = `company=${v === 'all' ? '' : encodeURIComponent(v)}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }
  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={pick} disabled={pending}>
        <SelectTrigger className="h-8 w-auto max-w-44 gap-1 text-xs" aria-label="Company"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All companies</SelectItem>
          {COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
    </div>
  );
}
