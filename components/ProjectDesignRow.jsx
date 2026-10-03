// Project View — the Calc Sheets + Drawings row. (Scope of Supply moved to its own card above this
// row — components/ScopeOfSupplyCard.jsx.) The standalone "Design signed off" badge is removed — per direct instruction, that
// wasn't asked for; what WAS asked for (per-drawing internal/customer approval ticks) already
// exists below, unchanged. Drawings keeps the real 3-state approval indicators: internal check/dash
// always shown, customer conditional — blank (not a dash) when the drawing was never sent to the
// customer at all.

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CheckIcon, DownloadIcon } from 'lucide-react';
import { drawingApprovalState } from '@/lib/drawing-approval.mjs';
import { TONE_CLASS } from '@/lib/status-styles';

const SHEET_STATUS_STYLE = {
  pass: { label: 'Pass', cls: TONE_CLASS.success },
  warn: { label: 'Warning', cls: TONE_CLASS.warning },
  fail: { label: 'Fail', cls: TONE_CLASS.destructive },
  no_data: { label: 'No snapshot yet', cls: TONE_CLASS.neutral },
};

function ApprovalDot({ state }) {
  if (state === null) return <span className="inline-block w-3.5" />; // not applicable — blank, never a dash
  return state === 'approved'
    ? <CheckIcon className="size-3.5 text-success" />
    : <span className="text-muted-foreground">—</span>;
}

export default function ProjectDesignRow({ projectId, calcSheets = [], drawings = [] }) {
  // DG- deep links (lib/entity-refs.js's resolveDrawing) append ?highlight= to scroll-to/flash the
  // right row — this is the one card on the redesigned page carrying data-entity-code, so it's the
  // one that needs to actually read it.
  useEntityHighlight(useSearchParams().get('highlight'));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calculation Sheets</CardTitle>
            <CardAction>
              <Button asChild size="sm" variant="outline"><Link href={`/calc/project/${projectId}`}>Open Calc Sheet</Link></Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {calcSheets.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-medium">{s.csNo && <span className="text-muted-foreground">{s.csNo} · </span>}{s.name}</span>
                <div className="flex items-center gap-2">
                  <Badge className={SHEET_STATUS_STYLE[s.status].cls} variant="outline">{SHEET_STATUS_STYLE[s.status].label}</Badge>
                  <Button asChild size="sm" variant="ghost"><Link href={`/calc/project/${projectId}/${s.id}`}>Open</Link></Button>
                </div>
              </div>
            ))}
            {calcSheets.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No calculation sheets yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drawings</CardTitle>
            <CardAction className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Internal</span><span>Customer</span>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {drawings.map(d => {
              const approval = drawingApprovalState({
                status: d.status, customer_visible: d.customerVisible, customer_approved_at: d.customerApprovedAt,
              });
              return (
                <div key={d.id} data-entity-code={d.dgNo} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{d.dgNo && <span className="text-muted-foreground">{d.dgNo} · </span>}{d.name}</span>
                    {/* Every uploaded file is a real download (proxied from storage, access-checked by the route). */}
                    {d.files?.length > 0 && (
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {d.files.map(f => (
                          <a key={f.id} href={`/api/calc-drawings/${d.id}/files/${f.id}`} download className="inline-flex items-center gap-1 text-primary hover:underline">
                            <DownloadIcon className="size-3" />{f.fileName}
                          </a>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <ApprovalDot state={approval.internal === 'approved' ? 'approved' : 'not-approved'} />
                    <ApprovalDot state={approval.customer} />
                  </div>
                </div>
              );
            })}
            {drawings.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No drawings yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
