'use client';

// components/reports/VendorLedgerCard.jsx — REPORT-ENGINE-PLAN.md §10. Mirror of
// CustomerLedgerCard.jsx, against suppliers. /api/suppliers has no search param (small table at
// this company's scale, per its own schema comment) — filters the full list client-side instead of
// CustomerLedgerCard's debounced server search.
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function VendorLedgerCard({ company }) {
  const [suppliers, setSuppliers] = useState([]);
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => { api('/api/suppliers').then(setSuppliers).catch(() => {}); }, []);

  const options = useMemo(() => {
    if (!query || supplier) return [];
    const q = query.toLowerCase();
    return suppliers.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20);
  }, [query, supplier, suppliers]);

  useEffect(() => {
    if (!supplier) { setData(null); return; }
    api(`/api/reports/vendor-ledger?company=${encodeURIComponent(company)}&supplier_id=${supplier.id}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, supplier]);

  function pick(s) { setSupplier(s); setQuery(s.name); }
  function clear() { setSupplier(null); setQuery(''); setData(null); }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Ledger</CardTitle>
        {supplier && (
          <CardAction className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/vendor-ledger/export?format=pdf&company=${encodeURIComponent(company)}&supplier_id=${supplier.id}`} target="_blank" rel="noreferrer">
                <DownloadIcon data-icon="inline-start" />PDF
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/vendor-ledger/export?format=xlsx&company=${encodeURIComponent(company)}&supplier_id=${supplier.id}`}>
                <FileSpreadsheetIcon data-icon="inline-start" />Excel
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <Input placeholder="Search supplier…" value={query} onChange={e => { setQuery(e.target.value); if (supplier) clear(); }} />
          {options.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {options.map(s => (
                <button key={s.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => pick(s)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {data && (
          <>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Opening Balance</span><span className="tnum">{fmt(data.openingBalance)}</span>
            </div>
            <div className="flex flex-col divide-y">
              {data.entries.map((e, i) => (
                <div key={i} className="flex justify-between gap-2 py-1.5 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">{e.date}</span>
                  <span className="flex-1 truncate">{e.kind} — {e.ref}</span>
                  <span className="tnum w-28 shrink-0 text-right">{e.debit ? `Dr ${fmt(e.debit)}` : `Cr ${fmt(e.credit)}`}</span>
                  <span className="tnum w-28 shrink-0 text-right font-medium">{fmt(e.balance)}</span>
                </div>
              ))}
              {!data.entries.length && <p className="py-2 text-sm text-muted-foreground">No activity.</p>}
            </div>
            <div className="flex justify-between border-t pt-2 text-sm font-medium">
              <span>Closing Balance</span><span className="tnum">{fmt(data.closingBalance)}</span>
            </div>
          </>
        )}
        {!supplier && <p className="text-sm text-muted-foreground">Search for a supplier to view their ledger.</p>}
      </CardContent>
    </Card>
  );
}
