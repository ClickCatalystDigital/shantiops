'use client';

// components/reports/BankReconciliationReportCard.jsx — REPORT-ENGINE-PLAN.md §10. Fresh, read-only
// card for the Reports tab — NOT AccountsWorkspace's BankReconciliationTab, which also carries the
// reconcile-toggle action (an operational workflow step, not a report view). Both call the exact
// same /api/reports/bank-reconciliation route.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

export default function BankReconciliationReportCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/bank-reconciliation?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Bank Reconciliation Statement</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-between text-sm font-medium">
          <span>Reconciled Balance</span><span className="tnum">{fmt(data.reconciledBalance)}</span>
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>Unreconciled Balance</span><span className="tnum">{fmt(data.unreconciledBalance)}</span>
        </div>
        <div className="flex flex-col divide-y">
          {data.lines.map(l => (
            <div key={l.id} className="flex justify-between gap-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{l.entry_date}</span>
              <span className="flex-1 truncate">{l.description || l.source_type}</span>
              <span className="tnum w-28 shrink-0 text-right">{l.debit ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}</span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{l.reconciled ? 'Reconciled' : 'Open'}</span>
            </div>
          ))}
          {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No postings yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
