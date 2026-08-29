'use client';

// components/reports/DrawingRegisterCard.jsx — Design management report: every drawing's
// status/assignee/due date across projects, "what's still open and what's overdue."
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, showToast } from '@/lib/client';

export default function DrawingRegisterCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/drawing-register?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Drawing Register</CardTitle>
        <p className="text-xs text-muted-foreground">{data.total} drawings · {data.approved} approved · {data.overdue} overdue</p>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {data.lines.map(d => (
          <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{d.project_no}</span>
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{d.dg_no || '—'}</span>
            <span className="flex-1 truncate">{d.name}</span>
            <span className="text-xs text-muted-foreground">{d.assigned_to || '—'}</span>
            <span className="text-xs text-muted-foreground">{d.due_date || '—'}</span>
            <Badge variant={d.overdue ? 'destructive' : 'outline'}>{d.status.replace(/_/g, ' ')}</Badge>
          </div>
        ))}
        {!data.lines.length && <p className="py-2 text-sm text-muted-foreground">No drawings in range.</p>}
      </CardContent>
    </Card>
  );
}
