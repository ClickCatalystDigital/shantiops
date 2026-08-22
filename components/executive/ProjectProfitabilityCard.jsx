'use client';

// components/executive/ProjectProfitabilityCard.jsx — Management report: margin by project,
// company-wide. Same company-switcher-as-buttons pattern as ManagementReportCard.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';

export default function ProjectProfitabilityCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/project-profitability?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Profitability</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data ? `${data.lines.length} projects · ${formatMoney(data.totalMargin)} total margin · ${data.overallMarginPct == null ? '—' : `${data.overallMarginPct}%`} overall` : 'Loading…'}
        </p>
        <CardAction className="flex items-center gap-2">
          {companies.map(c => (
            <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
              {c.legal_name}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/executive/project-profitability/pdf?company=${encodeURIComponent(company)}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data?.lines.map(p => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="w-20 shrink-0 font-medium">{p.project_no}</span>
            <span className="flex-1 truncate text-muted-foreground">{p.customer_name}</span>
            <span className="tnum text-xs text-muted-foreground">{formatMoney(p.sellingValue)} sold</span>
            <span className={`tnum font-medium ${p.margin < 0 ? 'text-danger' : 'text-success'}`}>
              {formatMoney(p.margin)} ({p.marginPct == null ? '—' : `${p.marginPct}%`})
            </span>
          </div>
        ))}
        {data && !data.lines.length && <p className="py-2 text-sm text-muted-foreground">No projects in range.</p>}
      </CardContent>
    </Card>
  );
}
