'use client';

// components/reports/ItcReconciliationReportCard.jsx — REPORT-ENGINE-PLAN.md §10 Phase 2. Fresh,
// read-only card for the Reports tab, mirrors AccountsWorkspace's ItcReconciliationCard's display
// (that one has no filing action, but stays separate anyway — same one-card-per-surface pattern as
// the GSTR-1/3B report cards, and this adds the period selector + PDF link neither needed before).
// Both call the exact same /api/reports/itc-reconciliation route.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

export default function ItcReconciliationReportCard({ company }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/reports/itc-reconciliation?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ITC Reconciliation</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="h-8 w-36" />
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/itc-reconciliation/export?format=pdf&company=${encodeURIComponent(company)}&period=${period}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      {data && (
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><span>GSTR-2B lines matched to a Vendor Bill</span><span className="tnum">{data.matchedCount} / {data.lines.length}</span></div>
          <div className="flex justify-between"><span>Eligible ITC</span><span className="tnum font-medium">{fmt(data.eligibleItc)}</span></div>
          <div className="flex justify-between"><span>Excluded (not available / rejected)</span><span className="tnum">{fmt(data.excludedItc)}</span></div>
          {data.unmatchedVendorBills.length > 0 && (
            <div className="mt-2 rounded-md border border-warning/20 bg-warning/10 p-2 text-xs text-warning">
              {data.unmatchedVendorBills.length} Vendor Bill(s) this period have no matching GSTR-2B line yet: {data.unmatchedVendorBills.map(b => b.bill_no).join(', ')}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
