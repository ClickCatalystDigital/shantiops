'use client';

// components/reports/CashBookCard.jsx — REPORT-ENGINE-PLAN.md §10.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function CashBookCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/cash-book?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Cash / Bank Book</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Opening Balance</span><span className="tnum">{fmt(data.openingBalance)}</span>
        </div>
        <div className="flex flex-col divide-y">
          {data.entries.map((e, i) => (
            <div key={i} className="flex justify-between gap-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{e.date}</span>
              <span className="flex-1 truncate">{e.kind}</span>
              <span className="tnum w-28 shrink-0 text-right">{e.debit ? `Dr ${fmt(e.debit)}` : `Cr ${fmt(e.credit)}`}</span>
              <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(e.balance)}</span>
            </div>
          ))}
          {!data.entries.length && <p className="py-2 text-sm text-muted-foreground">No postings yet.</p>}
        </div>
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Closing Balance</span><span className="tnum">{fmt(data.closingBalance)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
