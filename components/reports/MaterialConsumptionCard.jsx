'use client';

// components/reports/MaterialConsumptionCard.jsx — REPORT-ENGINE-PLAN.md §10.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function MaterialConsumptionCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/material-consumption?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Material Consumption Report</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.lines.map(l => (
          <div key={l.id} className="flex justify-between gap-2 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-muted-foreground">{l.project_no}</span>
            <span className="flex-1 truncate">{l.material_description}</span>
            <span className="tnum w-16 shrink-0 text-right text-muted-foreground">{l.qty}</span>
            <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(l.total_cost)}</span>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No costed consumption yet.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Cost</span><span className="tnum">{fmt(data.totalCost)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
