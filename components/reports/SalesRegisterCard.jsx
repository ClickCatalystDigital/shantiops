'use client';

// components/reports/SalesRegisterCard.jsx — REPORT-ENGINE-PLAN.md §10.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function SalesRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/sales-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Sales Register</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.invoices.map(i => (
          <div key={i.invoice_no} className="flex justify-between gap-2 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-muted-foreground">{i.invoice_date}</span>
            <span className="w-28 shrink-0 truncate">{i.invoice_no}</span>
            <span className="flex-1 truncate">{i.customer_name}</span>
            <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(i.total)}</span>
          </div>
        ))}
        {!data.invoices.length && <p className="py-2 text-sm text-muted-foreground">No invoices this period.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Value</span><span className="tnum">{fmt(data.totalValue)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
