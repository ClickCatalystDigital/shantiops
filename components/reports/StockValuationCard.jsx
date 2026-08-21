'use client';

// components/reports/StockValuationCard.jsx — REPORT-ENGINE-PLAN.md §10 Phase 1. Company-agnostic
// (Stores is one shared warehouse — see lib/reports/catalog.js's needsCompany: false), so unlike
// TrialBalanceCard/CustomerLedgerCard this never receives (or needs) a `company` prop.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function StockValuationCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/reports/stock-valuation').then(setData).catch(err => showToast(err.message, 'error'));
  }, []);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Stock Valuation</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.items.map(i => (
          <div key={i.id} className="flex justify-between gap-2 py-1.5 text-sm">
            <span className="w-28 shrink-0 truncate text-muted-foreground">{i.item_code || '—'}</span>
            <span className="flex-1 truncate">{i.description}</span>
            <span className="tnum w-20 shrink-0 text-right text-muted-foreground">{i.on_hand}</span>
            <span className="tnum w-24 shrink-0 text-right font-medium">{fmt(i.value)}</span>
          </div>
        ))}
        {!data.items.length && <p className="py-2 text-sm text-muted-foreground">No stock on hand.</p>}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total Value</span><span className="tnum">{fmt(data.totalValue)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
