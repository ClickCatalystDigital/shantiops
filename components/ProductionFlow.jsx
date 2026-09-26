// components/ProductionFlow.jsx
'use client';

// Operations' Production glance — the 33-stage Job Card (lib/job-sheet-stages.mjs), grouped.
// Each box counts jobs currently AT that group's stages; click a group to expand it into its
// individual stage boxes with exact counts. Counts come from getProductionFlowCounts() (lib/data.js).
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

export default function ProductionFlow({ counts, bare = false }) {
  const [open, setOpen] = useState(null);
  const groups = counts.groups || [];
  const openGroup = groups.find(g => g.key === open);

  const content = (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {counts.total} job card{counts.total === 1 ? '' : 's'} · {counts.finished} finished
        {counts.waitingOnQc > 0 && <> · <span className="font-medium text-warning">{counts.waitingOnQc} with stages waiting on QC sign</span></>}
        . Each box counts jobs currently at that stage — click a group to see its stages.
      </p>

      <div className="flex flex-wrap items-center gap-y-3">
        {groups.map((g, i) => (
          <div key={g.key} className="flex items-center">
            <button type="button" onClick={() => setOpen(open === g.key ? null : g.key)}
              aria-expanded={open === g.key}
              className={`flex min-w-[7rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm transition-colors hover:border-primary/50 ${open === g.key ? 'border-primary bg-primary/5' : g.count ? 'bg-warning-surface border-warning/20' : 'bg-card'}`}>
              <span className={`tnum text-xl font-semibold ${g.count ? 'text-foreground' : 'text-muted-foreground'}`}>{g.count}</span>
              <span className="flex items-center gap-1 text-center text-xs text-muted-foreground">
                {g.label}
                <ChevronDownIcon className={`size-3 transition-transform ${open === g.key ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {i < groups.length - 1 && <ChevronRightIcon className="mx-1.5 size-4 shrink-0 text-muted-foreground/40" />}
          </div>
        ))}
      </div>

      {openGroup && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{openGroup.label}</p>
          <div className="flex flex-wrap gap-2">
            {openGroup.stages.map(st => (
              <Link key={st.no} href={counts.href || '/production/shop?tab=jobcards'}
                className={`flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs shadow-sm hover:border-primary/50 ${st.count ? '' : 'opacity-60'}`}>
                <span className="tnum font-semibold text-foreground">{st.count}</span>
                <span className="text-muted-foreground">{st.no}. {st.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (bare) return content;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/production/shop">Open Job Card workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
