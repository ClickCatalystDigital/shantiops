'use client';

// components/bom-structure/ReleaseReadinessPanel.jsx — purely informational summary above the
// tree (per the plan: "do not invent arbitrary blocking rules"). The button fires the exact same,
// unmodified POST /api/projects/[id]/release-bom Requests' own Release BOM tab already uses —
// reachable identically from either place.
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2Icon, LayoutTemplateIcon, BookmarkPlusIcon } from 'lucide-react';
import BuildFromTemplatesDialog from './BuildFromTemplatesDialog';
import SaveBomAsTemplateDialog from './SaveBomAsTemplateDialog';

// One stat, given real visual weight (a large number, a small label below it) instead of every
// figure sitting at the same size in one run-on line — the flagged tiles (unassigned/pending ECN)
// pick up a warning tint once their count is non-zero, so the one number worth acting on actually
// draws the eye instead of reading identically to the rest.
function Stat({ value, label, tone }) {
  const flagged = tone === 'warn' && value > 0;
  return (
    <div className="flex flex-col gap-0.5 px-4 py-1 first:pl-0">
      <span className={`tnum text-2xl font-semibold leading-none ${flagged ? 'text-warning' : 'text-foreground'}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default function ReleaseReadinessPanel({
  status, onRelease, releasing, rootCount, onBuildFromTemplates, onSaveBomAsTemplate,
}) {
  const [buildingFromTemplates, setBuildingFromTemplates] = useState(false);
  const [savingBomAsTemplate, setSavingBomAsTemplate] = useState(false);
  if (!status) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex flex-wrap divide-x">
          <Stat value={status.bomCount} label={status.bomCount === 1 ? 'item' : 'items'} />
          <Stat value={status.drawingLinked} label="drawing-linked" />
          <Stat value={status.unassignedCount} label="unassigned" tone="warn" />
          <Stat value={status.pendingEcnCount} label={status.pendingEcnCount === 1 ? 'pending ECN' : 'pending ECNs'} tone="warn" />
        </div>
        <div className="flex items-center gap-1.5">
          {onBuildFromTemplates && (
            <Tooltip><TooltipTrigger asChild>
              <Button size="icon" variant="outline" onClick={() => setBuildingFromTemplates(true)} aria-label="Build from Templates">
                <LayoutTemplateIcon />
              </Button>
            </TooltipTrigger><TooltipContent>Build from Templates</TooltipContent></Tooltip>
          )}
          {onSaveBomAsTemplate && rootCount > 0 && (
            <Tooltip><TooltipTrigger asChild>
              <Button size="icon" variant="outline" onClick={() => setSavingBomAsTemplate(true)} aria-label="Save Entire BOM as Template">
                <BookmarkPlusIcon />
              </Button>
            </TooltipTrigger><TooltipContent>Save Entire BOM as Template</TooltipContent></Tooltip>
          )}
          {status.released ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2Icon className="size-4" />Released (rev {status.nextRevision - 1})
            </span>
          ) : (
            <Button disabled={releasing || !status.bomCount} onClick={onRelease}>
              {releasing ? 'Releasing…' : `Review & Release BOM (rev ${status.nextRevision})`}
            </Button>
          )}
        </div>
      </CardContent>

      {buildingFromTemplates && (
        <BuildFromTemplatesDialog onClose={() => setBuildingFromTemplates(false)} onApply={onBuildFromTemplates} />
      )}
      {savingBomAsTemplate && (
        <SaveBomAsTemplateDialog rootCount={rootCount} onClose={() => setSavingBomAsTemplate(false)} onSave={onSaveBomAsTemplate} />
      )}
    </Card>
  );
}
