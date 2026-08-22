'use client';

// components/executive/ManagementReportCard.jsx — REPORT-ENGINE-MATURITY.md §1.2's composite
// Management Report, as a card on /executive rather than a Reports-tab entry: executives don't get
// per-department Reports tabs (see components/Nav.jsx's isDeptPM gating), so this lives where they
// already land. Same company-switcher-as-buttons pattern as ReportsWorkspace.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { PnlComparisonChart } from './charts';

export default function ManagementReportCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/management-report?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  const tiles = data ? [
    { label: 'Cash & Bank', value: formatMoney(data.cash) },
    { label: 'Receivables Outstanding', value: formatMoney(data.arTotal) },
    { label: 'Payables Outstanding', value: formatMoney(data.apTotal) },
    { label: 'Inventory Value', value: formatMoney(data.inventoryValue) },
    { label: 'Working Capital', value: formatMoney(data.workingCapital) },
    { label: 'Revenue (MTD)', value: formatMoney(data.mtdPnl.totalIncome) },
    { label: 'Net Profit (MTD)', value: formatMoney(data.mtdPnl.netProfit) },
    { label: 'Net Profit (FY to date)', value: formatMoney(data.fytdPnl.netProfit) },
    { label: 'Total Assets', value: formatMoney(data.balanceSheet.totalAssets) },
  ] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Management Report</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data ? `As of ${data.asOf}` : 'Loading…'}
        </p>
        <CardAction className="flex items-center gap-2">
          {companies.map(c => (
            <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
              {c.legal_name}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/executive/management-report/pdf?company=${encodeURIComponent(company)}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(t => (
            <div key={t.label} className="rounded-lg border p-3">
              <div className="text-lg font-bold tnum">{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
        {data && <PnlComparisonChart mtd={data.mtdPnl} fytd={data.fytdPnl} />}
      </CardContent>
    </Card>
  );
}
