'use client';

// components/executive/CustomerProfitabilityCard.jsx — Management report: margin by customer,
// company-wide.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

export default function CustomerProfitabilityCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/customer-profitability?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Profitability</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data ? `${data.lines.length} customers · ${formatMoney(data.totalMargin)} total margin · ${data.overallMarginPct == null ? '—' : `${data.overallMarginPct}%`} overall` : 'Loading…'}
        </p>
        <CardAction className="flex items-center gap-2">
          {companies.map(c => (
            <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
              {c.legal_name}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/executive/customer-profitability/pdf?company=${encodeURIComponent(company)}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data?.lines.map(c => (
          <div key={c.customer_name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="flex-1 truncate font-medium">{c.customer_name}</span>
            <span className="text-xs text-muted-foreground">{c.projectCount} projects</span>
            <span className="tnum text-xs text-muted-foreground">{formatMoney(c.sellingValue)} sold</span>
            <span className={`tnum font-medium ${c.margin < 0 ? 'text-danger' : 'text-success'}`}>
              {formatMoney(c.margin)} ({c.marginPct == null ? '—' : `${c.marginPct}%`})
            </span>
          </div>
        ))}
        {data && !data.lines.length && <p className="py-2 text-sm text-muted-foreground">No customers in range.</p>}
      </CardContent>
    </Card>
  );
}
