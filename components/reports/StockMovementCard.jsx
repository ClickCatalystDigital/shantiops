'use client';

// components/reports/StockMovementCard.jsx — Opening / Added / Removed / Closing per item for a
// period, plus what each project consumed. Own From/To dates (hasOwnPdfControl in the catalog).
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { currentFyBounds } from '@/lib/date';
import { fmt } from './TrialBalanceCard';

export default function StockMovementCard() {
  const fy = currentFyBounds();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [data, setData] = useState(null);
  const qs = `from=${from}&to=${to}`;

  useEffect(() => {
    setData(null);
    api(`/api/reports/stock-movement?from=${from}&to=${to}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [from, to]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Movement &amp; Project Consumption</CardTitle>
        <CardAction className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/stock-movement/export?format=pdf&${qs}`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />PDF</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/stock-movement/export?format=xlsx&${qs}`}><FileSpreadsheetIcon data-icon="inline-start" />Excel</a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-xs">From<Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-36" /></label>
          <label className="grid gap-1 text-xs">To<Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-36" /></label>
        </div>
        {!data ? <p className="py-4 text-sm text-muted-foreground">Loading…</p> : (<>
          {data.clampedFrom && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Stock history is recorded from {data.historyStart}. Earlier dates can&apos;t be reported, so this starts there.
            </p>
          )}
          {data.mismatches > 0 && (
            <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
              {data.mismatches} item(s) have a closing balance that differs from what is on hand now. Please tell the developer — a stock change was not recorded.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Item</th>
                {['Opening', 'Added', 'Removed', 'Closing', 'Value'].map(h => <th key={h} className="py-1 text-right font-medium">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y">
                {data.stockRows.map(r => (
                  <tr key={r.id}>
                    <td className="py-1.5"><span className="block max-w-[14rem] truncate">{r.description}</span><span className="text-[11px] text-muted-foreground">{r.item_code}</span></td>
                    <td className="tnum text-right">{r.opening}</td><td className="tnum text-right">{r.added}</td>
                    <td className="tnum text-right">{r.removed}</td><td className="tnum text-right font-medium">{r.closing}</td>
                    <td className="tnum text-right">{fmt(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.stockRows.length && <p className="py-3 text-sm text-muted-foreground">No stock movement in this period.</p>}
          </div>
          <div className="flex justify-between border-t pt-2 text-sm font-medium"><span>Closing stock value</span><span className="tnum">{fmt(data.totalClosingValue)}</span></div>

          <h3 className="text-sm font-semibold">Project-wise consumption</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Project</th><th className="py-1 font-medium">Material</th><th className="py-1 font-medium">How</th>
                <th className="py-1 text-right font-medium">Qty</th><th className="py-1 text-right font-medium">Cost</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.consumption.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5">{r.project_no}</td>
                    <td><span className="block max-w-[14rem] truncate">{r.material}</span></td>
                    <td className="text-xs text-muted-foreground">{r.how}</td>
                    <td className="tnum text-right">{r.qty}</td><td className="tnum text-right">{r.cost == null ? '—' : fmt(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.consumption.length && <p className="py-3 text-sm text-muted-foreground">Nothing consumed in this period.</p>}
          </div>
        </>)}
      </CardContent>
    </Card>
  );
}
