'use client';

// components/reports/Gstr3bReportCard.jsx — REPORT-ENGINE-PLAN.md §10 Phase 2. Fresh, read-only
// card for the Reports tab, not AccountsWorkspace's Gstr3bCard (which also carries the "mark as
// filed" GstFilingButton). Both call the exact same /api/reports/gstr3b route.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DownloadIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

function currentPeriod() { return new Date().toISOString().slice(0, 7); }

export default function Gstr3bReportCard({ company }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/api/reports/gstr3b?company=${encodeURIComponent(company)}&period=${period}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, period]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GSTR-3B</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="h-8 w-36" />
          <Button asChild size="sm" variant="outline">
            <a href={`/api/reports/gstr3b/export?format=pdf&company=${encodeURIComponent(company)}&period=${period}`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />PDF
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      {data && (
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><span>Outward tax (GSTR-1)</span><span className="tnum">{fmt(data.outwardTax)}</span></div>
          <div className="flex justify-between"><span>Eligible ITC</span><span className="tnum">{fmt(data.eligibleItc)}</span></div>
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>{data.netPayable > 0 ? 'Net payable' : 'ITC carried forward'}</span>
            <span className="tnum">{fmt(data.netPayable > 0 ? data.netPayable : data.itcCarriedForward)}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
