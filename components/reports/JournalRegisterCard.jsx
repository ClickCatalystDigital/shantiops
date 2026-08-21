'use client';

// components/reports/JournalRegisterCard.jsx — REPORT-ENGINE-PLAN.md §10.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function JournalRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/journal-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Journal Register</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.entries.map(e => (
          <div key={e.id} className="flex justify-between gap-2 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-muted-foreground">{e.entry_date}</span>
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{e.source_type}</span>
            <span className="flex-1 truncate">{e.description || '—'}</span>
            <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(e.amount)}</span>
          </div>
        ))}
        {!data.entries.length && <p className="py-2 text-sm text-muted-foreground">No posted entries yet.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total</span><span className="tnum">{fmt(data.total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
