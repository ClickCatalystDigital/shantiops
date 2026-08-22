'use client';

// components/reports/EcnRegisterCard.jsx — Design management report: every Engineering Change Note
// across projects/period, the audit trail of what changed on a released BOM and why.
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, showToast } from '@/lib/client';

const STATUS_VARIANT = { approved: 'default', rejected: 'destructive', pending: 'outline' };

export default function EcnRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/ecn-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>ECN Register</CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.total} ECNs · {data.pending} pending · {data.approved} approved · {data.rejected} rejected
        </p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(e => (
          <div key={e.id} className="flex flex-col gap-1 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{e.created_at?.slice(0, 10)}</span>
              <span className="flex-1 truncate font-medium">{e.project_no} — {e.field_changed}</span>
              <Badge variant={STATUS_VARIANT[e.status] || 'outline'}>{e.status}</Badge>
            </div>
            <div className="pl-24 text-xs text-muted-foreground">
              {e.old_value ?? '—'} → {e.new_value ?? '—'} · {e.reason}
            </div>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No ECNs in range.</p>}
      </CardContent>
    </Card>
  );
}
