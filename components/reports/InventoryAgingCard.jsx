'use client';

// components/reports/InventoryAgingCard.jsx — REPORT-ENGINE-PLAN.md §10. Same bucket totals as
// components/reports/AgingCard.jsx but "Item / Last Movement / Value" labels instead of
// "Party / Due Date / Outstanding".
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

const BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'];

export default function InventoryAgingCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/reports/inventory-aging').then(setData).catch(err => showToast(err.message, 'error'));
  }, []);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Inventory Aging</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          {BUCKETS.map(b => (
            <div key={b}><span className="text-muted-foreground">{b}: </span><span className="tnum font-medium">{fmt(data.totals[b])}</span></div>
          ))}
        </div>
        <div className="flex flex-col divide-y">
          {data.items.map((i, idx) => (
            <div key={idx} className="flex justify-between gap-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 truncate text-muted-foreground">{i.ref}</span>
              <span className="flex-1 truncate">{i.party}</span>
              <span className="w-16 shrink-0 text-center text-xs text-muted-foreground">{i.bucket}</span>
              <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(i.outstanding)}</span>
            </div>
          ))}
          {!data.items.length && <p className="py-2 text-sm text-muted-foreground">No stock on hand.</p>}
        </div>
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Value</span><span className="tnum">{fmt(data.total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
