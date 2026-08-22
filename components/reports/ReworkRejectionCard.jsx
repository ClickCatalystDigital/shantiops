'use client';

// components/reports/ReworkRejectionCard.jsx — Production management report: Job Card rejections +
// QC test failures, the quality-cost signal REPORT-ENGINE-PLAN.md §8 flagged as missing.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, showToast } from '@/lib/client';

export default function ReworkRejectionCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/rework-rejection?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rework / Rejection Report</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.totalQtyRejected} rejected · {data.totalQcFailures} QC failures · {data.reworkCardsCreated} rework cards created
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h4 className="mb-1 text-sm font-medium">Job Card Rejections</h4>
          <div className="flex flex-col divide-y">
            {data.jobCardRejections.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{r.updated_at?.slice(0, 10)}</span>
                <span className="flex-1 truncate">{r.section}{r.wo_no ? ` — ${r.wo_no}` : ''}</span>
                <span className="text-xs text-muted-foreground">{r.project_no || 'Stock'}</span>
                <span className="tnum font-medium text-danger">{r.qty_rejected}</span>
                {r.rework_of_job_card_id && <Badge variant="outline">reworked</Badge>}
              </div>
            ))}
            {!data.jobCardRejections.length && <p className="py-1.5 text-sm text-muted-foreground">No rejections in range.</p>}
          </div>
        </div>
        <div>
          <h4 className="mb-1 text-sm font-medium">QC Test Failures</h4>
          <div className="flex flex-col divide-y">
            {data.qcFailures.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{r.tested_on}</span>
                <span className="flex-1 truncate">{r.test_type}</span>
                <span className="text-xs text-muted-foreground">{r.project_no}</span>
                <Badge variant="destructive">fail</Badge>
              </div>
            ))}
            {!data.qcFailures.length && <p className="py-1.5 text-sm text-muted-foreground">No QC failures in range.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
