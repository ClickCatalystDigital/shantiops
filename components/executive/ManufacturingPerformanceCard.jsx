'use client';

// components/executive/ManufacturingPerformanceCard.jsx — Management report: the director-altitude
// headline for the shop floor. Same tile-grid look as ManagementReportCard.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';

export default function ManufacturingPerformanceCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/manufacturing-performance?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  const tiles = data ? [
    { label: 'Work Orders (Total / In Progress / Delayed / Completed)', value: `${data.totalWO} / ${data.inProgressWO} / ${data.delayedWO} / ${data.completedWO}` },
    { label: 'Rejection Rate', value: data.rejectionRatePct == null ? '—' : `${data.rejectionRatePct}%` },
    { label: 'Material Yield', value: data.overallYieldPct == null ? '—' : `${data.overallYieldPct}%` },
    { label: 'Cost Variance', value: `${data.totalCostVariance >= 0 ? '+' : ''}${Math.round(data.totalCostVariance).toLocaleString('en-IN')}` },
  ] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manufacturing Performance Summary</CardTitle>
        <CardAction className="flex items-center gap-2">
          {companies.map(c => (
            <Button key={c.company} size="sm" variant={company === c.company ? 'default' : 'outline'} onClick={() => setCompany(c.company)}>
              {c.legal_name}
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/executive/manufacturing-performance/pdf?company=${encodeURIComponent(company)}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(t => (
            <div key={t.label} className="rounded-lg border p-3">
              <div className="text-lg font-bold tnum">{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
