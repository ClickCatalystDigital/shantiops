'use client';

// components/reports/OpenPoAgingCard.jsx — Procurement report: issued POs with at least one line
// still in transit, aged by days since issue — "what's stuck in the pipeline right now."
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function OpenPoAgingCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/open-po-aging?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open PO Aging</CardTitle>
        <p className="text-xs text-muted-foreground">{data.total} open POs · {fmt(data.totalOpenValue)} open value · oldest {data.oldestDaysOpen}d</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(p => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="w-24 shrink-0 font-medium">{p.po_no}</span>
            <span className="flex-1 truncate text-muted-foreground">{p.supplier_name}</span>
            <span className="tnum text-xs text-muted-foreground">{p.open_line_count} lines</span>
            <span className="tnum font-medium">{fmt(p.open_value)}</span>
            <Badge variant={p.daysOpen > 30 ? 'destructive' : 'outline'}>{p.daysOpen}d</Badge>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No open POs.</p>}
      </CardContent>
    </Card>
  );
}
