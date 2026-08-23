'use client';

// components/reports/MaterialShortageCard.jsx — Production management report: outstanding material
// demand across open Work Orders within a horizon (forward-looking, not a from/to period — same
// data getProductionForecast() already computes for the Forecast tab, §5l). Own PDF control since
// the horizon selector isn't the generic toolbar's from/to shape (catalog.js: hasOwnPdfControl).
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

const HORIZONS = [15, 30, 60, 90];

export default function MaterialShortageCard() {
  const [horizonDays, setHorizonDays] = useState(30);
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/reports/material-shortage?horizon_days=${horizonDays}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [horizonDays]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material Shortage / Demand</CardTitle>
        <CardAction className="flex items-center gap-2">
          {HORIZONS.map(h => (
            <Button key={h} size="sm" variant={horizonDays === h ? 'default' : 'outline'} onClick={() => setHorizonDays(h)}>
              {h}d
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/material-shortage/export?format=pdf&horizon_days=${horizonDays}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/material-shortage/export?format=xlsx&horizon_days=${horizonDays}`}>
              <FileSpreadsheetIcon data-icon="inline-start" />Excel
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!data && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && (
          <>
            <div>
              <h4 className="mb-1 text-sm font-medium">Outstanding Material Demand</h4>
              <div className="flex flex-col divide-y">
                {data.materialDemand.map((m, i) => (
                  <div key={i} className="flex justify-between py-1.5 text-sm">
                    <span className="flex-1 truncate">{m.material}</span>
                    <span className="tnum font-medium">{m.qty_outstanding}</span>
                  </div>
                ))}
                {!data.materialDemand.length && <p className="py-1.5 text-sm text-muted-foreground">No outstanding material demand in this horizon.</p>}
              </div>
            </div>
            <div>
              <h4 className="mb-1 text-sm font-medium">Work Orders in Horizon</h4>
              <div className="flex flex-col divide-y">
                {data.workOrders.map(w => (
                  <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                    <span className="w-24 shrink-0 font-medium">{w.wo_no}</span>
                    <span className="flex-1 truncate text-muted-foreground">{w.project_no || 'Stock'}</span>
                    <span className="tnum text-xs text-muted-foreground">{w.planned_start} → {w.planned_end || '—'}</span>
                  </div>
                ))}
                {!data.workOrders.length && <p className="py-1.5 text-sm text-muted-foreground">No Work Orders due in this horizon.</p>}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
