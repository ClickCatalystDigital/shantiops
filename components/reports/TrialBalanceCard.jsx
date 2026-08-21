'use client';

// components/reports/TrialBalanceCard.jsx — extracted from components/AccountsWorkspace.jsx so both
// AccountsWorkspace's existing Ledger tab and the new Reports tab (ReportsWorkspace) render the
// same screen component instead of two copies. REPORT-ENGINE-PLAN Phase 3: the Accounts screen
// views (TrialBalanceCard, ProfitLossCard, ...) were module-private, non-exported functions — this
// is the first one pulled out; AccountRow/fmt come with it since it depends on them, and
// AccountsWorkspace imports them back for its own ProfitLossCard/BalanceSheetCard.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';

export function fmt(n) { return (n ?? 0).toLocaleString('en-IN'); }

export function AccountRow({ a }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="tnum text-muted-foreground">{a.account_code ?? a.code}</span>
      <span className="flex-1 px-2">{a.account_name ?? a.name}</span>
      <span className="tnum font-medium">{fmt(a.balance)}</span>
    </div>
  );
}

export default function TrialBalanceCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/trial-balance?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Trial Balance</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-1">
        {data.accounts.map(a => <AccountRow key={a.account_code} a={a} />)}
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Total</span>
          <span className="tnum">Dr {fmt(data.totalDebit)} / Cr {fmt(data.totalCredit)}</span>
        </div>
        {!data.accounts.length && <p className="py-2 text-sm text-muted-foreground">No postings yet.</p>}
      </CardContent>
    </Card>
  );
}
