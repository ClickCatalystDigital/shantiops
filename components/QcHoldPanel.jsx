'use client';

// Hold points (plan §5d) — job cards waiting on a QC release before they can be marked done.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GaugeIcon } from 'lucide-react';

export default function QcHoldPanel({ holdPoints = [] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);

  async function release(id) {
    setBusyId(id);
    try {
      await api(`/api/job-cards/${id}/qc-release`, { method: 'POST' });
      showToast('Hold point released');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusyId(null);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Hold Points</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y">
        {holdPoints.length === 0 && <p className="text-sm text-muted-foreground">No job cards held for QC right now.</p>}
        {holdPoints.map(h => (
          <div key={h.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
            <GaugeIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">{h.project_no}</span>
            <span className="text-muted-foreground">{h.section}</span>
            {h.wo_no && <span className="text-xs text-muted-foreground">{h.wo_no}</span>}
            <Button size="sm" variant="outline" className="ml-auto" disabled={busyId === h.id} onClick={() => release(h.id)}>
              {busyId === h.id ? 'Releasing…' : 'Release'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
