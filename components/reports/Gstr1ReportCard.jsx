'use client';

// components/reports/Gstr1ReportCard.jsx — REPORT-ENGINE-PLAN.md §10 Phase 2. A fresh, read-only
// card for the Reports tab — NOT the same component as AccountsWorkspace's Gstr1Card, which also
// carries the "mark as filed" GstFilingButton actions (an operational workflow step, not a report
// view). Both call the exact same /api/reports/gstr1 route, so they can never disagree — ground
// rule 2 is about the shared computed result, not shared UI.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

export default function Gstr1ReportCard({ company }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/reports/gstr1?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GSTR-1 / IFF — Outward Supplies</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="h-8 w-36" />
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/gstr1/export?format=pdf&company=${encodeURIComponent(company)}&period=${period}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/gstr1/export?format=xlsx&company=${encodeURIComponent(company)}&period=${period}`}>
              <FileSpreadsheetIcon data-icon="inline-start" />Excel
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      {data && (
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">B2B summary (by customer GSTIN)</p>
            {data.b2b.map(g => (
              <div key={g.customer_gstin || g.customer_name} className="flex justify-between py-1 text-sm">
                <span>{g.customer_name} <span className="text-muted-foreground">({g.customer_gstin || 'no GSTIN'}) · {g.invoice_count} inv.</span></span>
                <span className="tnum">{fmt(g.taxable)} + {fmt(g.cgst + g.sgst + g.igst)} tax</span>
              </div>
            ))}
            {!data.b2b.length && <p className="py-2 text-sm text-muted-foreground">No issued/paid invoices this period.</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">HSN summary</p>
            {data.hsn.map(h => (
              <div key={h.hsn_code || 'unspecified'} className="flex justify-between py-1 text-sm">
                <span>{h.hsn_code || 'Unspecified'} <span className="text-muted-foreground">qty {fmt(h.qty)}</span></span>
                <span className="tnum">{fmt(h.taxable)} + {fmt(h.cgst + h.sgst + h.igst)} tax</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t pt-2 text-sm font-medium">
            <span>Total taxable / tax</span>
            <span className="tnum">{fmt(data.totalTaxable)} / {fmt(data.totalTax)}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
