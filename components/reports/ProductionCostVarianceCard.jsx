'use client';

// components/reports/ProductionCostVarianceCard.jsx — Production management report: planned vs
// actual material+labour per Work Order, the core manufacturing cost-control view.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function ProductionCostVarianceCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/production-cost-variance?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Production Cost Variance</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(w => (
          <div key={w.id} className="flex flex-col gap-1 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{w.wo_no}</span>
              <span className="flex-1 truncate text-muted-foreground">{w.project_no || 'Stock'}</span>
              <span className={`tnum font-medium ${w.totalVariance > 0 ? 'text-danger' : 'text-success'}`}>
                {fmt(w.totalVariance)} ({w.variancePct}%)
              </span>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Material: plan {fmt(w.plannedMaterialCost)} / actual {fmt(w.actualMaterialCost)}</span>
              <span>Labour: plan {fmt(w.plannedLaborCost)} / actual {fmt(w.actualLaborCost)}</span>
            </div>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No in-progress/completed Work Orders in range.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Variance</span>
          <span className={`tnum ${data.totalVariance > 0 ? 'text-danger' : 'text-success'}`}>{fmt(data.totalVariance)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
