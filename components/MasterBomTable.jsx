'use client';

// Master BOM as a searchable, paginated table — scales to however many active projects have open
// BOM work without the page becoming one long scroll. Priority sorting is a follow-up pass; this
// keeps whatever order getBomWork() already returns.
//
// Deliberately does NOT reuse BomStageBar's 5-color segmented bar here. That bar earns its detail
// on the project page, where the reader is looking at one project and wants the full stage-by-stage
// picture. In a table scanning many rows, five colors per row stop being a signal and become noise
// you'd need a legend to decode, over and over, row after row — exactly the "heavier than the rest"
// problem this codebase already pushed back on once (see ProcurementFlow.jsx's header notes on the
// Cancelled-tile restraint). A table needs one strong signal per row instead: how far along
// (closed/total, one fill) and what it's stuck on (the single dominant open stage, named in text).
// Full stage detail is one click away on the project page — this is a scanning surface, not a
// replacement for it.
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { OPEN_STATUSES, STAGE_BAR_COLORS } from '@/lib/bom-fields.mjs';

const PAGE_SIZE = 10;
// Iteration order of a Set follows insertion order in JS, and OPEN_STATUSES is defined as
// ['Enquiry','Comparison','Ordered','Transit'] in lib/bom-fields.mjs — so this stays in lockstep
// with the real D4 pipeline order without a second hand-maintained array.
const OPEN_STAGE_ORDER = [...OPEN_STATUSES];

// The one open stage with the most items sitting in it — "what's this project actually stuck on,"
// not a full breakdown. Ties resolve to whichever stage comes first in pipeline order (earliest
// stage reads as the more actionable bottleneck when counts are equal).
function bottleneck(stages) {
  let best = null;
  for (const stage of OPEN_STAGE_ORDER) {
    const n = stages[stage] || 0;
    if (n > 0 && (!best || n > best.count)) best = { stage, count: n };
  }
  return best;
}

function ProgressBar({ closed, total }) {
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tnum text-muted-foreground">{closed}/{total}</span>
    </div>
  );
}

function BottleneckChip({ w }) {
  if (w.total === 0) return <span className="text-xs font-medium text-warning">BOM not uploaded</span>;
  const b = bottleneck(w.stages);
  if (!b) return <span className="text-xs text-success">All received</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-1.5 shrink-0 rounded-full ${STAGE_BAR_COLORS[b.stage]}`} />
      {b.stage} <span className="tnum">· {b.count}</span>
    </span>
  );
}

function useFilteredPage(bomWork, search, page) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bomWork;
    return bomWork.filter(w =>
      w.project_no.toLowerCase().includes(needle) || w.customer_name.toLowerCase().includes(needle));
  }, [bomWork, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
  return { filtered, pageCount, clampedPage, shown };
}

export default function MasterBomTable({ bomWork }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const { filtered, pageCount, clampedPage, shown } = useFilteredPage(bomWork, search, page);

  function onSearchChange(v) {
    setSearch(v);
    setPage(0); // reset to page 1 on every filter change, else you can land on a now-empty page
  }

  if (!bomWork.length) return null;

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-base">Master BOM</CardTitle>
        <CardAction className="text-xs text-muted-foreground tnum">{bomWork.length} project{bomWork.length !== 1 ? 's' : ''}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <Input value={search} onChange={e => onSearchChange(e.target.value)}
          placeholder="Search project or customer…" className="h-8 w-64" />

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No projects match.</p>
        ) : (
          <>
            {/* Desktop: a real table — semantic, room for a sort control later without restructuring. */}
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="w-32 py-2 font-medium">Project</th>
                  <th className="py-2 font-medium">Customer</th>
                  <th className="w-40 py-2 font-medium">Progress</th>
                  <th className="w-36 py-2 font-medium">Bottleneck</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map(w => (
                  <tr key={w.id} onClick={() => router.push(`/projects/${w.id}`)}
                    className="cursor-pointer transition-colors hover:bg-muted/40">
                    <td className="py-2.5 pr-3">
                      <Link href={`/projects/${w.id}`} onClick={e => e.stopPropagation()}
                        className="font-medium text-primary hover:underline">{w.project_no}</Link>
                    </td>
                    <td className="truncate py-2.5 pr-3 text-muted-foreground">{w.customer_name}</td>
                    <td className="py-2.5 pr-3">
                      {w.total > 0 ? <ProgressBar closed={w.closed} total={w.total} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5"><BottleneckChip w={w} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: cards, not a squeezed table — same convention this app already uses for
                Projects (SYSTEM.md §18: "tables like Projects render as cards on mobile"). */}
            <div className="flex flex-col divide-y sm:hidden">
              {shown.map(w => (
                <Link key={w.id} href={`/projects/${w.id}`}
                  className="flex flex-col gap-2 py-3 transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-primary">{w.project_no}</span>
                    <span className="truncate text-xs text-muted-foreground">{w.customer_name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {w.total > 0 ? <ProgressBar closed={w.closed} total={w.total} /> : <span className="text-xs text-muted-foreground">No items yet</span>}
                    <BottleneckChip w={w} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
            <span>Page {clampedPage + 1} of {pageCount} · {filtered.length} project{filtered.length !== 1 ? 's' : ''}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
                disabled={clampedPage === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
                disabled={clampedPage >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}