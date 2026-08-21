'use client';

// components/reports/ProfitLossCard.jsx — extracted from components/AccountsWorkspace.jsx (same
// move as TrialBalanceCard.jsx), so AccountsWorkspace's Ledger tab and the Reports tab render the
// same component instead of two copies.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { AccountRow, fmt } from './TrialBalanceCard';

export default function ProfitLossCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/profit-loss?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Profit &amp; Loss</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Income</p>
          {data.income.map(a => <AccountRow key={a.account_code} a={a} />)}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Expense</p>
          {data.expense.map(a => <AccountRow key={a.account_code} a={a} />)}
        </div>
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Net Profit</span>
          <span className="tnum">{fmt(data.netProfit)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
