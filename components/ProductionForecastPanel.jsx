'use client';

import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

// Production Forecasting (STERP item 20, §5l) — upcoming material/production load off open Work
// Orders' planned dates, route-card time, and outstanding material lines.
export default function ProductionForecastPanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/api/production/forecast?days=30').then(setData).catch(err => showToast(err.message, 'error'));
  }, []);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.workOrders.length) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">No released Work Orders due in the next {data.horizonDays} days.</CardContent></Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Upcoming Work Orders (next {data.horizonDays} days)</p>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>WO No.</TableHead><TableHead>Project / Product</TableHead><TableHead>Qty</TableHead><TableHead>Planned</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.workOrders.map(wo => (
                <TableRow key={wo.id}>
                  <TableCell className="font-medium">{wo.wo_no}</TableCell>
                  <TableCell>{wo.project_no ? `${wo.project_no} · ${wo.customer_name}` : '—'}</TableCell>
                  <TableCell className="tnum">{wo.qty_planned}</TableCell>
                  <TableCell className="text-muted-foreground">{wo.planned_start || '—'} → {wo.planned_end || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Workstation load (open route steps)</p>
        {data.workstationLoad.length === 0 ? <p className="text-xs text-muted-foreground">No route-card time planned yet.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.workstationLoad.map(w => (
              <Card key={w.workstation_id}><CardContent className="flex items-center justify-between py-3 text-sm">
                <span>{w.workstation_name}</span>
                <span className="flex items-center gap-2 tnum text-muted-foreground">
                  {Math.round(w.planned_minutes / 60)}h / {Math.round(w.capacityMinutes / 60)}h
                  {w.overloaded && <Badge variant="destructive">Overloaded</Badge>}
                </span>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Material demand outstanding</p>
        {data.materialDemand.length === 0 ? <p className="text-xs text-muted-foreground">Nothing outstanding.</p> : (
          <Card><CardContent className="flex flex-col gap-1 py-3">
            {data.materialDemand.map(m => (
              <div key={m.material} className="flex items-center justify-between text-sm">
                <span>{m.material}</span><span className="tnum text-muted-foreground">{m.qty_outstanding}</span>
              </div>
            ))}
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
