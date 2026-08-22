'use client';

// components/reports/MaterialUtilizationCard.jsx — Production management report: used vs
// remnant-recovered vs scrap weight per cut, the material-saved-vs-scrapped cost story
// (REPORT-ENGINE-PLAN.md §8). No company switcher — cut material is shared shop stock.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';

export default function MaterialUtilizationCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/reports/material-utilization').then(setData).catch(err => showToast(err.message, 'error'));
  }, []);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Material Utilization Report</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.totalSource} kg cut · {data.totalUsed} kg used · {data.totalRemnant} kg remnant recovered ·
          {' '}{data.totalScrap} kg scrap · {data.overallYieldPct}% overall yield
        </p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(l => (
          <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{l.cut_at?.slice(0, 10)}</span>
            <span className="w-20 shrink-0 font-medium">{l.code}</span>
            <span className="flex-1 truncate text-muted-foreground">{l.description || l.item_code || '—'}</span>
            <span className="tnum text-xs">used {l.used_weight}kg</span>
            <span className="tnum text-xs text-success">remnant {l.remnant_weight}kg</span>
            <span className="tnum text-xs text-danger">scrap {l.scrap_weight}kg</span>
            <span className="tnum font-medium">{l.yield_pct}%</span>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No cutting activity in range.</p>}
      </CardContent>
    </Card>
  );
}
