'use client';

// components/reports/CustomerLedgerCard.jsx — REPORT-ENGINE-PLAN.md §10 Phase 1. Unlike Trial
// Balance, this report needs an extra selection (which customer) before it has anything to show —
// a debounced type-ahead against the existing /api/customers?search= endpoint (app/api/customers/
// route.js), same search shape PeoplePanel-style pickers elsewhere in the app already use.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function CustomerLedgerCard({ company }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!query || customer) { setOptions([]); return; }
    const t = setTimeout(() => {
      api(`/api/customers?search=${encodeURIComponent(query)}`).then(setOptions).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query, customer]);

  useEffect(() => {
    if (!customer) { setData(null); return; }
    api(`/api/reports/customer-ledger?company=${encodeURIComponent(company)}&customer_id=${customer.id}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, customer]);

  function pick(c) {
    setCustomer(c);
    setQuery(c.name);
    setOptions([]);
  }

  function clear() {
    setCustomer(null);
    setQuery('');
    setData(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Ledger</CardTitle>
        {customer && (
          <CardAction>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/customer-ledger/export?format=pdf&company=${encodeURIComponent(company)}&customer_id=${customer.id}`} target="_blank" rel="noreferrer">
                <DownloadIcon data-icon="inline-start" />PDF
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <Input
            placeholder="Search customer…"
            value={query}
            onChange={e => { setQuery(e.target.value); if (customer) clear(); }}
          />
          {options.length > 0 && !customer && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {options.map(c => (
                <button key={c.id} type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => pick(c)}>
                  {c.name}
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
              {!data.entries.length && <p className="py-2 text-sm text-muted-foreground">No activity in range.</p>}
            </div>
            <div className="flex justify-between border-t pt-2 text-sm font-medium">
              <span>Closing Balance</span><span className="tnum">{fmt(data.closingBalance)}</span>
            </div>
          </>
        )}
        {!customer && <p className="text-sm text-muted-foreground">Search for a customer to view their ledger.</p>}
      </CardContent>
    </Card>
  );
}
