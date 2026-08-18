import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getExecutiveSummary, getProjectsWithStatus, getErpSnapshot, getOpportunityPipelineCounts, getProcurementFlowCounts, getWorkforceCounts, getDependencyHealthSummary } from '@/lib/data';
import { getFreshSessionUser, isManager, roleHome } from '@/lib/auth';
import { todayISO } from '@/lib/date';
import StatusBadge from '@/components/StatusBadge';
import PortfolioDelayTimeline from '@/components/PortfolioDelayTimeline';
import ProcurementFlow from '@/components/ProcurementFlow';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { deltaLabel } from '@/lib/delay';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// V3_CHANGES.md §12 invariant amendment — Finance + statutory Payroll tiles still read ONLY
// erp_snapshot (never computed here, per §2.4); HR went native (Phase 3) so headcount/attendance
// is real data now, shown in WorkforceCard below instead of this snapshot row.
const SNAPSHOT_TILES = [
  { key: 'receivables_outstanding', label: 'Receivables' },
  { key: 'cash_position', label: 'Cash Position' },
  { key: 'invoice_total_mtd', label: 'Invoiced (MTD)' },
  { key: 'invoice_paid_mtd', label: 'Paid (MTD)' },
  { key: 'payroll_mtd', label: 'Payroll (MTD)' },
];

function SnapshotRow({ snapshot }) {
  const rows = SNAPSHOT_TILES.map(t => snapshot[t.key]).filter(Boolean);
  const asOf = rows.length ? new Date(rows[0].as_of).toLocaleString() : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance</CardTitle>
        {asOf && (
          <p className="text-xs text-muted-foreground">
            As of {asOf} · <Badge variant={rows[0].source === 'erpnext' ? 'default' : 'outline'}>
              {rows[0].source === 'erpnext' ? 'ERPNext' : 'Demo data'}
            </Badge>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SNAPSHOT_TILES.map(t => {
            const row = snapshot[t.key];
            return (
              <div key={t.key} className="rounded-lg border p-3">
                <div className="text-lg font-bold tnum">{row?.value_text ?? '—'}</div>
                <div className="text-xs text-muted-foreground">{t.label}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// V3_CHANGES.md §12 Phase 5 — real data, no snapshot/badge (HR is native, not deferred).
function WorkforceCard({ workforce }) {
  const tiles = [
    { label: 'Active Headcount', value: workforce.headcount },
    { label: 'Present Today', value: workforce.presentToday },
    { label: 'On Leave Today', value: workforce.onLeaveToday },
    { label: 'Open Roles', value: workforce.openOpenings },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workforce</CardTitle>
        <p className="text-xs text-muted-foreground"><Link href="/hr" className="hover:underline">Open HR workspace →</Link></p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(t => (
            <div key={t.label} className="rounded-lg border p-3">
              <div className="text-lg font-bold tnum">{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineCard({ pipeline }) {
  const { counts, openValue, total } = pipeline;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Pipeline</CardTitle>
        <p className="text-xs text-muted-foreground">
          <Link href="/pipeline" className="hover:underline">{total} opportunities</Link> · {formatMoney(openValue)} open
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Object.entries(counts).map(([stage, n]) => (
            <div key={stage} className="rounded-lg border p-3">
              <div className="text-lg font-bold tnum">{n}</div>
              <div className="text-xs text-muted-foreground">{stage}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function Executive() {
  const user = await getFreshSessionUser();
  if (!isManager(user)) redirect(roleHome(user));

  const [{ kpi, delayedBy, topRisks, forecast }, projects, snapshot, pipeline, procurementCounts, workforce, dependencyHealth] = await Promise.all([
    getExecutiveSummary(),
    getProjectsWithStatus(),
    getErpSnapshot(),
    getOpportunityPipelineCounts(),
    getProcurementFlowCounts(),
    getWorkforceCounts(todayISO()),
    getDependencyHealthSummary(),
  ]);
  const deptRows = Object.entries(dependencyHealth.byDepartment).sort((a, b) => b[1] - a[1]);
  const deptMax = deptRows.reduce((a, [, n]) => Math.max(a, n), 0) || 1;

  const stats = [
    { label: 'Projects', value: kpi.total },
    { label: 'Healthy', value: kpi.healthy, tone: 'text-success' },
    { label: 'Delayed', value: kpi.delayed, tone: 'text-warning' },
    { label: 'Critical', value: kpi.critical, tone: 'text-danger' },
    { label: 'Completed', value: kpi.completed },
    { label: 'Avg Delay', value: `${kpi.avgDelay}d` },
    { label: 'Value in Progress', value: formatMoney(kpi.valueInProgress) },
  ];
  const delayRows = Object.entries(delayedBy).sort((a, b) => b[1] - a[1]);
  const delayMax = delayRows.reduce((a, [, n]) => Math.max(a, n), 0) || 1;

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Executive Overview" description="Health, risks and delivery forecast across all projects" />

      {/* Row 1: KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <div className={`text-2xl font-bold tnum ${s.tone || ''}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 2: 360 pillars — live (Sales Pipeline, Workforce, Procurement) + snapshot-backed
          (Finance/statutory Payroll only, per §12's invariant amendment — HR is native now).
          Production/QC/Dispatch/Supplier-performance pillars are deliberately not duplicated here
          — the Milestone Tracker + Top Risks below already cover portfolio operational health. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PipelineCard pipeline={pipeline} />
        <WorkforceCard workforce={workforce} />
      </div>
      <ProcurementFlow counts={procurementCounts} />
      <SnapshotRow snapshot={snapshot} />

      {/* Row 3: milestone tracker */}
      <PortfolioDelayTimeline projects={projects} />

      {/* Row 3: risks + delay reasons */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Top Risks</CardTitle></CardHeader>
          <CardContent>
            {topRisks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active risks. 🎉</p>
            ) : (
              <div className="flex flex-col divide-y">
                {topRisks.map(r => (
                  <Link key={r.id} href={`/projects/${r.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm -mx-2 px-2 rounded transition-colors hover:bg-muted/40">
                    <StatusBadge status={{ code: r.code, label: r.code === 'overdue' ? 'Overdue' : 'Blocked' }} />
                    <span className="font-medium">{r.project_no}</span>
                    <span className="text-muted-foreground">{r.milestone_label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{r.delay_category || '—'}</span>
                    <span className="text-xs font-semibold text-danger tnum">+{r.impactDays}d</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Delayed Because</CardTitle></CardHeader>
          <CardContent>
            {delayRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categorised delays.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {delayRows.map(([cat, n]) => (
                  <div key={cat} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">{cat}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(n / delayMax) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right font-semibold tnum">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dependency Chain rollup (SYSTEM.md §5j) — cross-project blocked_by/out_of_order, the
          instrument for watching where the chain actually reads as blocked and where
          milestone-auto disagrees with it, without clicking through every project. Read-only. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dependency-Blocked, by Department</CardTitle></CardHeader>
          <CardContent>
            {deptRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing currently waiting on a dependency. 🎉</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {deptRows.map(([dept, n]) => (
                  <div key={dept} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">{dept}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(n / deptMax) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right font-semibold tnum">{n}</span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">{dependencyHealth.blockedCount} milestone(s) total, across active projects.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Finished Out of Order</CardTitle></CardHeader>
          <CardContent>
            {dependencyHealth.outOfOrder.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contradictions found — nothing finished ahead of its own predecessor.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {dependencyHealth.outOfOrder.map((o, i) => (
                  <Link key={i} href={`/projects/${o.project_id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm -mx-2 px-2 rounded transition-colors hover:bg-muted/40">
                    <span className="font-medium">{o.project_no}</span>
                    <span className="text-muted-foreground">{o.milestone_label}</span>
                    <span className="ml-auto text-xs text-warning">ahead of {o.out_of_order.department}: {o.out_of_order.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Delivery Forecast</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Current stage</TableHead>
                  <TableHead>BOM</TableHead>
                  <TableHead>Delay</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Est. Dispatch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecast.map(p => (
                  <TableRow key={p.id}>
                    <TableCell><Link href={`/projects/${p.id}`} className="font-medium text-primary hover:underline">{p.project_no}</Link></TableCell>
                    <TableCell>{p.customer_name}</TableCell>
                    <TableCell><StatusBadge status={p.roll} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground tnum">{p.progress}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.currentStage}</TableCell>
                    <TableCell>
                      {p.bom ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-success" style={{ width: `${p.bom.closedPct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground tnum">{p.bom.closedPct}%</span>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className={cn('text-sm font-semibold tnum',
                        p.cumDelay > 0 ? 'text-danger' : p.cumDelay < 0 ? 'text-success' : 'text-muted-foreground')}>
                        {deltaLabel(p.cumDelay)}
                      </span>
                    </TableCell>
                    <TableCell className="tnum">{formatMoney(p.value)}</TableCell>
                    <TableCell className="tnum">{p.estDispatch ? formatDate(p.estDispatch) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
