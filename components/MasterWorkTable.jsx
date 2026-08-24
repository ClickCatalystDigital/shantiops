// components/MasterWorkTable.jsx
'use client';

// The shared table for every department's unified Operations card (operations-tab-changes.md) —
// generalizes what MasterBomTable.jsx and DesignMasterTable.jsx each built separately: search +
// pagination + a `columns` config after the fixed Project/Customer lead columns. Always renders
// bare (no Card chrome) — every caller is Row 3 of components/OperationsCard.jsx, which already
// owns the Card.
//
// `columns` is plain data (`{ key, label, width, kind, field }`), not render functions — this
// component is instantiated from app/page.js (a Server Component), and a function prop can't cross
// the Server→Client boundary. `kind` picks one of a small fixed set of cell treatments:
//   - 'progress'      — field points to a { done, total } pair on the row; renders the fill-bar
//                        treatment MasterBomTable.jsx originated (one strong signal per row,
//                        deliberately not a 5-color segmented bar — see that file's original header
//                        notes on why stage detail becomes noise in a table scanning many rows).
//   - 'bottleneckChip'— no field needed; reads the row's own `total`/`stages` (the BOM-item shape
//                        getBomWork returns) and renders the colored dominant-open-stage chip.
//   - 'ratioText'     — field points to a { done, total } pair; renders plain "done/total" text
//                        (secondary metrics like Design's Calc Status/Drawings, not the primary
//                        progress column).
//   - 'text'          — field points to a plain string (or null); renders it, or an em dash.
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { OPEN_STATUSES, STAGE_BAR_COLORS } from '@/lib/bom-fields.mjs';

const PAGE_SIZE = 15;
const OPEN_STAGE_ORDER = [...OPEN_STATUSES];

function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tnum text-muted-foreground">{done}/{total}</span>
    </div>
  );
}

// The one open stage with the most items sitting in it — "what's this project actually stuck on."
function bottleneck(stages) {
  let best = null;
  for (const stage of OPEN_STAGE_ORDER) {
    const n = stages[stage] || 0;
    if (n > 0 && (!best || n > best.count)) best = { stage, count: n };
  }
  return best;
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

function Cell({ w, col }) {
  switch (col.kind) {
    case 'progress': {
      const { done = 0, total = 0 } = w[col.field] || {};
      return <ProgressBar done={done} total={total} />;
    }
    case 'bottleneckChip':
      return <BottleneckChip w={w} />;
    case 'ratioText': {
      const { done = 0, total = 0 } = w[col.field] || {};
      return <span className="tnum text-muted-foreground">{done}/{total}</span>;
    }
    case 'text':
    default:
      return <span className="text-muted-foreground">{w[col.field] || '—'}</span>;
  }
}

function useFilteredPage(work, search, page) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return work;
    return work.filter(w =>
      w.project_no.toLowerCase().includes(needle) || w.customer_name.toLowerCase().includes(needle));
  }, [work, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
  return { filtered, pageCount, clampedPage, shown };
}

export default function MasterWorkTable({ work, columns, emptyMessage = 'Nothing here yet.' }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const { filtered, pageCount, clampedPage, shown } = useFilteredPage(work, search, page);

  function onSearchChange(v) {
    setSearch(v);
    setPage(0);
  }

  if (!work.length) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;

  return (
    <div className="flex flex-col gap-3">
      <Input value={search} onChange={e => onSearchChange(e.target.value)}
        placeholder="Search project or customer…" className="h-8 w-64" />

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No projects match.</p>
      ) : (
        <>
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-32 py-2 font-medium">Project</th>
                <th className="py-2 font-medium">Customer</th>
                {columns.map(c => <th key={c.key} className={`${c.width || ''} py-2 font-medium`}>{c.label}</th>)}
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
                  {columns.map(c => <td key={c.key} className="py-2.5 pr-3"><Cell w={w} col={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile: cards, not a squeezed table — same convention as Projects (SYSTEM.md §18). */}
          <div className="flex flex-col divide-y sm:hidden">
            {shown.map(w => (
              <Link key={w.id} href={`/projects/${w.id}`}
                className="flex flex-col gap-2 py-3 transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-primary">{w.project_no}</span>
                  <span className="truncate text-xs text-muted-foreground">{w.customer_name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {columns.map(c => <div key={c.key}><Cell w={w} col={c} /></div>)}
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
    </div>
  );
}
