'use client';

// components/SubsystemReport.jsx — Engineering → Subsystems. Read-only: pick a subsystem family (FD Fan Blower, Feed
// Line…) and see every line it holds across the real projects, with how many projects have it. The Design Head reads
// this to decide what a standard build contains; nothing here changes any BOM.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeftIcon } from 'lucide-react';
import { ReportShell } from '@/components/ReportKit';
import { api, showToast } from '@/lib/client';

function FamilyList({ families, onPick }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (families || []).filter(f => f.label.toLowerCase().includes(q.trim().toLowerCase())), [families, q]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subsystems</CardTitle>
        <CardDescription>Every kind of subsystem found in the BOM trees, and how many projects have it. Pick one to see what it contains.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search subsystems…" className="max-w-sm" />
        {families === null ? <Skeleton className="h-40 w-full" /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Subsystem</TableHead><TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Lines</TableHead><TableHead className="text-right">Not linked</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map(f => (
                <TableRow key={f.key} className="cursor-pointer" onClick={() => onPick(f.key)}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell className="text-right tnum">{f.projects}</TableCell>
                  <TableCell className="text-right tnum">{f.items}</TableCell>
                  <TableCell className="text-right tnum">{f.unlinked || '—'}</TableCell>
                </TableRow>
              ))}
              {shown.length === 0 && <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">No subsystem matches.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Cell({ cell }) {
  if (!cell) return <span className="text-muted-foreground/40">·</span>;
  if (typeof cell === 'string') return <span>{cell}</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {cell.map((c, i) => <span key={i} className="whitespace-nowrap">{[c.size_spec, c.qty_text].filter(Boolean).join(' · ') || '✓'}</span>)}
    </div>
  );
}

function Matrix({ data, onBack }) {
  const M = data.projects.length;
  const count = n => `${n} of ${M}`;
  const paths = [...new Set(data.rows.map(r => r.path))];
  return (
    <div className="flex flex-col gap-3">
      <div><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeftIcon />All subsystems</Button></div>
      <ReportShell title={`${data.family.label} — ${M} project${M === 1 ? '' : 's'}`}
        description="Each row is a line; the number says how many of these projects have it. Projects are sorted by model and capacity, so builds sit side by side.">
        <div className="overflow-x-auto">
          <Table data-export-title={data.family.label}>
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-card">Line</TableHead>
              <TableHead className="text-right">In</TableHead>
              {data.projects.map(p => (
                <TableHead key={p.id} className="min-w-32 align-bottom">
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.project_no}</Link>
                  <div className="text-[11px] font-normal text-muted-foreground">{[p.series, p.capacity].filter(Boolean).join(' · ') || ' '}</div>
                  {p.nodes > 1 && <div className="text-[11px] font-normal text-warning">{p.nodes} nodes</div>}
                </TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>
              {data.configRows.length > 0 && (
                <TableRow className="bg-muted/40"><TableCell colSpan={2 + M} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configuration (datasheet values)</TableCell></TableRow>
              )}
              {data.configRows.map(r => (
                <TableRow key={`c:${r.label}`}>
                  <TableCell className="sticky left-0 bg-card">
                    {r.label}{r.alsoItem && <Badge variant="outline" className="ml-2 text-[10px] font-normal text-warning" title="Also written as a BOM item on some projects — decide once whether it is configuration or an item">also an item</Badge>}
                  </TableCell>
                  <TableCell className="text-right tnum">{count(r.count)}</TableCell>
                  {data.projects.map(p => <TableCell key={p.id}><Cell cell={r.cells[p.id]} /></TableCell>)}
                </TableRow>
              ))}
              {paths.map(path => (
                <FragmentRows key={path || '_own'} path={path} rows={data.rows.filter(r => r.path === path)} projects={data.projects} count={count} M={M} />
              ))}
            </TableBody>
          </Table>
        </div>
      </ReportShell>
    </div>
  );
}

function FragmentRows({ path, rows, projects, count, M }) {
  return (
    <>
      <TableRow className="bg-muted/40"><TableCell colSpan={2 + M} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{path || 'Lines'}</TableCell></TableRow>
      {rows.map(r => (
        <TableRow key={r.key}>
          <TableCell className="sticky left-0 bg-card">
            {r.label}{r.unlinked && <Badge variant="outline" className="ml-2 text-[10px] font-normal text-muted-foreground">not linked</Badge>}
          </TableCell>
          <TableCell className="text-right tnum" data-raw={r.count}>{count(r.count)}</TableCell>
          {projects.map(p => <TableCell key={p.id}><Cell cell={r.cells[p.id]} /></TableCell>)}
        </TableRow>
      ))}
    </>
  );
}

export default function SubsystemReport() {
  const [families, setFamilies] = useState(null);
  const [key, setKey] = useState(null);
  const [matrix, setMatrix] = useState(null);

  useEffect(() => { api('/api/subsystem-report').then(r => setFamilies(r.families)).catch(e => { showToast(e.message, 'error'); setFamilies([]); }); }, []);
  useEffect(() => {
    if (!key) { setMatrix(null); return; }
    setMatrix(null);
    api(`/api/subsystem-report?family=${encodeURIComponent(key)}`).then(setMatrix).catch(e => { showToast(e.message, 'error'); setKey(null); });
  }, [key]);

  if (!key) return <FamilyList families={families} onPick={setKey} />;
  if (!matrix) return <Skeleton className="h-64 w-full" />;
  return <Matrix data={matrix} onBack={() => setKey(null)} />;
}
