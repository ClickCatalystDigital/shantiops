// Project View redesign, Wave 3 — the canonical, never-duplicated Sales Order + Calc Sheets +
// Drawings row. Introduced at Design phase, stays exactly here unchanged through every later phase
// (Decision D — lower rows accumulate, never swap). Supersedes DesignPanel.jsx's old project-page
// card: the standalone Design Sign-off card, Activity feed, and full ScopeOfSupplyPanel are all
// gone from here (Decision F/G) — Sign-off surfaces as a small badge below, Activity has no other
// consumer, and full SoS editing moved to /projects (Part 4). Drawings gets the real 3-state
// approval indicators (Decision H): internal check/dash always shown, customer conditional —
// blank (not a dash) when the drawing was never sent to the customer at all.
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

export default function ProjectDesignRow({ projectId, scopeOfSupply = [], calcSheets = [], drawings = [], designSignedOff = false }) {
  // DG- deep links (lib/entity-refs.js's resolveDrawing) append ?highlight= to scroll-to/flash the
  // right row — this is the one card on the redesigned page carrying data-entity-code, so it's the
  // one that needs to actually read it.
  useEntityHighlight(useSearchParams().get('highlight'));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {scopeOfSupply.map(sos => (
          <Button key={sos.id} asChild size="sm" variant="outline">
            <a href={`/api/scope-of-supply/${sos.id}/pdf`} target="_blank" rel="noreferrer">
              <DownloadIcon data-icon="inline-start" />Sales Order — {sos.title}
            </a>
          </Button>
        ))}
        {designSignedOff && (
          <span className="inline-flex items-center gap-1 text-xs text-success"><CheckIcon className="size-3.5" />Design signed off</span>
        )}
      </div>

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
                  <span className="text-sm font-medium">{d.dgNo && <span className="text-muted-foreground">{d.dgNo} · </span>}{d.name}</span>
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
