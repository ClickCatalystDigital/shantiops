'use client';

// components/executive/ManufacturingPerformanceCard.jsx — Management report: the director-altitude
// headline for the shop floor. Same tile-grid look as ManagementReportCard.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { WorkOrderStatusPie, CostVarianceChart } from './charts';

export default function ManufacturingPerformanceCard({ companies }) {
  const [company, setCompany] = useState(companies[0]?.company);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!company) return;
    api(`/api/executive/manufacturing-performance?company=${encodeURIComponent(company)}`)
      .then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);

  const tiles = data ? [
    { label: 'Total Work Orders', value: String(data.totalWO) },
    { label: 'Delayed', value: String(data.delayedWO), danger: data.delayedWO > 0 },
    { label: 'Rejection Rate', value: data.rejectionRatePct == null ? '—' : `${data.rejectionRatePct}%`, danger: data.rejectionRatePct > 10 },
    { label: 'QC Failures', value: String(data.qcFailures), danger: data.qcFailures > 0 },
    { label: 'Material Yield', value: data.overallYieldPct == null ? '—' : `${data.overallYieldPct}%` },
    { label: 'Labour Hours / Cost', value: `${data.totalLabourHours}h / ${formatMoney(data.totalLabourCost)}` },
    { label: 'Cost Variance', value: `${data.totalCostVariance >= 0 ? '+' : ''}${Math.round(data.totalCostVariance).toLocaleString('en-IN')}`, danger: data.totalCostVariance > 0 },
    { label: 'Material Lines Blocking Production (30d)', value: String(data.outstandingMaterialLines), danger: data.outstandingMaterialLines > 0 },
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
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(t => (
            <div key={t.label} className="rounded-lg border p-3">
              <div className={`text-lg font-bold tnum ${t.danger ? 'text-danger' : ''}`}>{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
        {data && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Work Order Status</p>
              <WorkOrderStatusPie
                inProgress={data.inProgressWO}
                completed={data.completedWO}
                notStarted={data.notStartedWO}
                cancelled={data.cancelledWO}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Planned vs Actual Cost</p>
              <CostVarianceChart planned={data.totalPlannedCost} actual={data.totalActualCost} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
