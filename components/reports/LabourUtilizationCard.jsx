'use client';

// components/reports/LabourUtilizationCard.jsx — Production management report: hours + cost per
// employee off job_card_time_logs.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function LabourUtilizationCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/labour-utilization?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Labour Utilization Report</CardTitle>
        <p className="text-xs text-muted-foreground">{data.totalHours} hours · {fmt(data.totalCost)} total labour cost</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(l => (
          <div key={l.employee_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="flex-1 truncate font-medium">{l.employee_name}</span>
            <span className="text-xs text-muted-foreground">{l.trade || '—'}</span>
            <span className="tnum text-xs text-muted-foreground">{l.job_cards_worked} cards</span>
            <span className="tnum">{Math.round((l.total_minutes / 60) * 10) / 10}h</span>
            <span className="tnum font-medium">{fmt(l.labor_cost)}</span>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No logged time in range.</p>}
      </CardContent>
    </Card>
  );
}
