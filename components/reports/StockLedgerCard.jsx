'use client';

// components/reports/StockLedgerCard.jsx — REPORT-ENGINE-PLAN.md §10. Mirror of
// VendorLedgerCard.jsx, against inventory items instead of suppliers. /api/inventory-items has no
// search param either — filters client-side.
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

export default function StockLedgerCard() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [item, setItem] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => { api('/api/inventory-items').then(setItems).catch(() => {}); }, []);

  const options = useMemo(() => {
    if (!query || item) return [];
    const q = query.toLowerCase();
    return items.filter(i => i.description.toLowerCase().includes(q) || (i.item_code || '').toLowerCase().includes(q)).slice(0, 20);
  }, [query, item, items]);

  useEffect(() => {
    if (!item) { setData(null); return; }
    api(`/api/reports/stock-ledger?item_id=${item.id}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [item]);

  function pick(i) { setItem(i); setQuery(i.description); }
  function clear() { setItem(null); setQuery(''); setData(null); }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Ledger</CardTitle>
        {item && (
          <CardAction>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/stock-ledger/export?format=pdf&item_id=${item.id}`} target="_blank" rel="noreferrer">
                <DownloadIcon data-icon="inline-start" />PDF
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <Input placeholder="Search item…" value={query} onChange={e => { setQuery(e.target.value); if (item) clear(); }} />
          {options.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {options.map(i => (
                <button key={i.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => pick(i)}>
                  {i.item_code ? `${i.item_code} — ` : ''}{i.description}
                </button>
              ))}
            </div>
          )}
        </div>

        {data && (
          <>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Opening Qty</span><span className="tnum">{data.openingBalance}</span>
            </div>
            <div className="flex flex-col divide-y">
              {data.entries.map((e, i) => (
                <div key={i} className="flex justify-between gap-2 py-1.5 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">{e.date}</span>
                  <span className="flex-1 truncate">{e.kind} — {e.ref}</span>
                  <span className="tnum w-24 shrink-0 text-right">{e.debit ? `+${e.debit}` : `-${e.credit}`}</span>
                  <span className="tnum w-24 shrink-0 text-right font-medium">{e.balance}</span>
                </div>
              ))}
              {!data.entries.length && <p className="py-2 text-sm text-muted-foreground">No movement.</p>}
            </div>
            <div className="flex justify-between border-t pt-2 text-sm font-medium">
              <span>Closing Qty</span><span className="tnum">{data.closingBalance}</span>
            </div>
          </>
        )}
        {!item && <p className="text-sm text-muted-foreground">Search for an item to view its stock ledger.</p>}
      </CardContent>
    </Card>
  );
}
