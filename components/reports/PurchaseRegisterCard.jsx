'use client';

// components/reports/PurchaseRegisterCard.jsx — REPORT-ENGINE-PLAN.md §10.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function PurchaseRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/purchase-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Purchase Register</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.bills.map(b => (
          <div key={b.bill_no} className="flex justify-between gap-2 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-muted-foreground">{b.bill_date}</span>
            <span className="w-28 shrink-0 truncate">{b.bill_no}</span>
            <span className="flex-1 truncate">{b.supplier_name}</span>
            <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(b.payable_amount)}</span>
          </div>
        ))}
        {!data.bills.length && <p className="py-2 text-sm text-muted-foreground">No bills this period.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Payable</span><span className="tnum">{fmt(data.totalPayable)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
