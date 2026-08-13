// components/DesignMasterTable.jsx

'use client';

// CALC-CHANGES2.md §E — Design's master table on Operations, same columns/spirit as
// MasterBomTable but without its search machinery (Design's row count is small enough that search
// hasn't earned its keep here; add it back if that stops being true).
//
// `bare` renders just the table (no Card chrome, no "Projects" label) — used as Row 3 of
// DesignOperationsCard, the Operations page's unified Design card. Paginated at 15 rows/page.
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';

const BARE_PAGE_SIZE = 15;

function Row({ w }) {
  return (
    <tr className="hover:bg-muted/40">
      <td className="py-2.5 pr-3"><Link href={`/projects/${w.id}`} className="font-medium text-primary hover:underline">{w.project_no}</Link></td>
      <td className="truncate py-2.5 pr-3 text-muted-foreground">{w.customer_name}</td>
      <td className="py-2.5 pr-3 tnum text-muted-foreground">{w.designProgress.done}/{w.designProgress.total}</td>
      <td className="py-2.5 pr-3 text-muted-foreground">{w.bottleneck || '—'}</td>
      <td className="py-2.5 pr-3 tnum text-muted-foreground">{w.calcStatus.done}/{w.calcStatus.total}</td>
      <td className="py-2.5 tnum text-muted-foreground">{w.drawings.done}/{w.drawings.total}</td>
    </tr>
  );
}

function Head() {
  return (
    <thead>
      <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <th className="w-32 py-2 font-medium">Project</th>
        <th className="py-2 font-medium">Customer</th>
        <th className="w-32 py-2 font-medium">Design Progress</th>
        <th className="py-2 font-medium">Bottleneck</th>
        <th className="w-28 py-2 font-medium">Calc Status</th>
        <th className="w-24 py-2 font-medium">Drawings</th>
      </tr>
    </thead>
  );
}

export default function DesignMasterTable({ designWork, bare = false }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(designWork.length / BARE_PAGE_SIZE));
  const paged = useMemo(() => {
    const start = page * BARE_PAGE_SIZE;
    return designWork.slice(start, start + BARE_PAGE_SIZE);
  }, [designWork, page]);
  if (page > 0 && page >= pageCount) setPage(pageCount - 1);

  if (!designWork.length) return null;

  if (bare) {
    return (
      <div className="flex flex-col gap-2">
        <table className="w-full text-sm">
          <Head />
          <tbody className="divide-y">{paged.map(w => <Row key={w.id} w={w} />)}</tbody>
        </table>
        {designWork.length > BARE_PAGE_SIZE && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {page * BARE_PAGE_SIZE + 1}–{Math.min((page + 1) * BARE_PAGE_SIZE, designWork.length)} of {designWork.length}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
              <span className="text-xs tnum text-muted-foreground">{page + 1}/{pageCount}</span>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={page >= pageCount - 1}
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-base">Design</CardTitle>
        <CardAction className="text-xs text-muted-foreground tnum">{designWork.length} project{designWork.length !== 1 ? 's' : ''}</CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        <table className="w-full text-sm">
          <Head />
          <tbody className="divide-y">{designWork.map(w => <Row key={w.id} w={w} />)}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}