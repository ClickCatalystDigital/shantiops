'use client';

// components/ProjectsListTable.jsx — the Projects list's table/card rendering, extracted from
// app/projects/page.js so a split master's real children (lib/data.js's groupProjectsByMaster) can
// be shown collapsed-by-default under their master instead of cluttering the list as N+1 separate
// top-level rows. A project with no children renders byte-identical to the original inline markup —
// this only adds behavior for the one case that's new.
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { DepartmentPills, DepartmentProgress } from '@/components/DepartmentStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function ProjectCard({ p, indent }) {
  return (
    <Link href={`/projects/${p.id}`}>
      <Card className={`transition-colors hover:border-primary/40 ${indent ? 'ml-4' : ''}`}>
        <CardContent className="flex flex-col gap-1 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-primary">{p.project_no}</span>
            <StatusBadge status={p.roll} />
          </div>
          <div className="text-sm">{p.customer_name}</div>
          <div className="text-xs text-muted-foreground">{p.description || '—'}</div>
          <div className="mt-1"><DepartmentPills departmentProgress={p.departmentProgress} /></div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <DepartmentProgress departmentProgress={p.departmentProgress} />
            <span className="text-muted-foreground">Overall {p.overallDone}/{p.overallTotal}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ProjectRow({ p, indent }) {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/projects/${p.id}`} className={`font-medium text-primary hover:underline ${indent ? 'ml-6 inline-block' : ''}`}>
          {p.project_no}
        </Link>
      </TableCell>
      <TableCell>{p.customer_name}</TableCell>
      <TableCell className="text-muted-foreground">{p.description || '—'}</TableCell>
      <TableCell className="tnum">{p.order_date || '—'}</TableCell>
      <TableCell className="tnum"><DepartmentProgress departmentProgress={p.departmentProgress} /></TableCell>
      <TableCell className="tnum text-muted-foreground">{p.overallDone}/{p.overallTotal}</TableCell>
      <TableCell>
        <StatusBadge status={p.roll} />
        <div className="mt-1"><DepartmentPills departmentProgress={p.departmentProgress} /></div>
      </TableCell>
    </TableRow>
  );
}

const PAGE_SIZE = 10;

export default function ProjectsListTable({ projects: all, action }) {
  const [expanded, setExpanded] = useState(new Set());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // A master matches on its own fields or any of its units' project numbers (children stay behind its toggle).
  const needle = q.trim().toLowerCase();
  const hit = (p, deep) => [p.project_no, p.customer_name, p.description].some(v => String(v || '').toLowerCase().includes(needle))
    || (deep && (p.children || []).some(c => String(c.project_no || '').toLowerCase().includes(needle)));
  const filtered = needle ? all.filter(p => hit(p, true)) : all;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const projects = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const emptyText = needle ? 'No projects match your search.' : 'No projects yet.';
  const toggle = id => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by project no., customer or description" className="h-9 pl-9" />
        </div>
        {action}
      </div>
      {/* Mobile: cards. Desktop: table. */}
      <div className="grid gap-3 sm:hidden">
        {projects.map(p => (
          <div key={p.id} className="flex flex-col gap-2">
            {p.childSummary ? (
              <button type="button" onClick={() => toggle(p.id)} className="text-left">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-1 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 font-semibold text-primary">
                        {expanded.has(p.id) ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                        {p.project_no}
                      </span>
                      <Badge variant="outline">{p.childSummary.done} of {p.childSummary.total} units done</Badge>
                    </div>
                    <div className="text-sm">{p.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{p.description || '—'}</div>
                    <DepartmentPills departmentProgress={p.departmentProgress} />
                  </CardContent>
                </Card>
              </button>
            ) : (
              <ProjectCard p={p} />
            )}
            {p.childSummary && expanded.has(p.id) && (
              <div className="flex flex-col gap-2 border-l-2 pl-2">
                {p.children.map(c => <ProjectCard key={c.id} p={c} indent />)}
              </div>
            )}
          </div>
        ))}
        {projects.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      </div>

      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead><TableHead>Customer</TableHead>
                <TableHead>Description</TableHead><TableHead>Order Date</TableHead>
                <TableHead>Department Progress</TableHead><TableHead>Overall Progress</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => (
                <Fragment key={p.id}>
                  {p.childSummary ? (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(p.id)}>
                      <TableCell>
                        <span className="flex items-center gap-1 font-medium text-primary">
                          {expanded.has(p.id) ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                          {p.project_no}
                        </span>
                      </TableCell>
                      <TableCell>{p.customer_name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.description || '—'}</TableCell>
                      <TableCell className="tnum">{p.order_date || '—'}</TableCell>
                      {/* The master carries the shared BOM, purchasing and receiving — show its own
                          departments, plus how many units are done. */}
                      <TableCell className="tnum"><DepartmentProgress departmentProgress={p.departmentProgress} /></TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.childSummary.done} of {p.childSummary.total} units done</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.roll} />
                        <div className="mt-1"><DepartmentPills departmentProgress={p.departmentProgress} /></div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <ProjectRow key={p.id} p={p} />
                  )}
                  {p.childSummary && expanded.has(p.id) && p.children.map(c => (
                    <ProjectRow key={c.id} p={c} indent />
                  ))}
                </Fragment>
              ))}
              {projects.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">{emptyText}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Page {cur} of {pages} · {filtered.length} projects</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}
