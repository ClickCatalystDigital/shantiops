'use client';

// components/reports/BalanceSheetCard.jsx — extracted from components/AccountsWorkspace.jsx (same
// move as TrialBalanceCard.jsx), so AccountsWorkspace's Ledger tab and the Reports tab render the
// same component instead of two copies.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { AccountRow, fmt } from './TrialBalanceCard';

export default function BalanceSheetCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/balance-sheet?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Balance Sheet</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Assets</p>
          {data.assets.map(a => <AccountRow key={a.account_code} a={a} />)}
          <div className="flex justify-between pt-1 text-sm font-medium"><span>Total Assets</span><span className="tnum">{fmt(data.totalAssets)}</span></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Liabilities</p>
          {data.liabilities.map(a => <AccountRow key={a.account_code} a={a} />)}
          <div className="flex justify-between pt-1 text-sm font-medium"><span>Total Liabilities</span><span className="tnum">{fmt(data.totalLiabilities)}</span></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Equity (incl. retained earnings)</p>
          {data.equity.map(a => <AccountRow key={a.account_code} a={a} />)}
          <div className="flex justify-between pt-1 text-sm font-medium"><span>Total Equity</span><span className="tnum">{fmt(data.totalEquity)}</span></div>
        </div>
      </CardContent>
    </Card>
  );
}
