'use client';

// components/executive/ProcurementSpendCard.jsx — Management report: spend by supplier,
// company-wide.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { RankedSpendChart } from './charts';

export default function ProcurementSpendCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/procurement-spend?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procurement Spend</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data ? `${data.lines.length} suppliers · ${formatMoney(data.totalPayable)} total payable` : 'Loading…'}
        </p>
        <CardAction className="flex items-center gap-2">
          {companies.map(c => (
            <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
              {c.legal_name}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/executive/procurement-spend/pdf?company=${encodeURIComponent(company)}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data && data.lines.length > 0 && (
          <RankedSpendChart items={data.lines.map(s => ({ label: s.supplier_name, value: s.payable }))} />
        )}
        <div className="flex flex-col divide-y">
          {data?.lines.map(s => (
            <div key={s.supplier_name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
              <span className="flex-1 truncate font-medium">{s.supplier_name}</span>
              <span className="text-xs text-muted-foreground">{s.billCount} bills</span>
              <span className="tnum font-medium">{formatMoney(s.payable)}</span>
            </div>
          ))}
          {data && !data.lines.length && <p className="py-2 text-sm text-muted-foreground">No spend in range.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
