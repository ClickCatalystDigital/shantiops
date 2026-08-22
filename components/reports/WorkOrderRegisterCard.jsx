'use client';

// components/reports/WorkOrderRegisterCard.jsx — Production management report: every Work Order's
// status, progress, and whether it's delayed — "what's in production and is it on time."
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, showToast } from '@/lib/client';

export default function WorkOrderRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/work-order-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Work Order Register</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.total} Work Orders · {data.inProgress} in progress · {data.delayed} delayed · {data.completed} completed
        </p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(w => (
          <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-24 shrink-0 font-medium">{w.wo_no}</span>
            <span className="flex-1 truncate text-muted-foreground">{w.project_no ? `${w.project_no} — ${w.customer_name || ''}` : 'Stock'}</span>
            <span className="tnum text-xs text-muted-foreground">{w.qty_done}/{w.qty_planned} ({w.pct}%)</span>
            {w.qty_rejected > 0 && <Badge variant="destructive">{w.qty_rejected} rejected</Badge>}
            <Badge variant={w.delayed ? 'destructive' : 'outline'}>{w.status}</Badge>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No Work Orders in range.</p>}
      </CardContent>
    </Card>
  );
}
