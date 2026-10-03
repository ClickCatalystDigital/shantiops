import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getExecutiveSummary, getProjectsWithStatus, getDependencyHealthSummary, getExecutiveBusiness } from '@/lib/data';
import { getFreshSessionUser, isManager, roleHome } from '@/lib/auth';
import { todayISO } from '@/lib/date';
import StatusBadge from '@/components/StatusBadge';
import PortfolioDelayTimeline from '@/components/PortfolioDelayTimeline';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { deltaLabel } from '@/lib/delay';
import { cn } from '@/lib/utils';
import { getSelectedCompany } from '@/lib/company-filter-server';
import { filterByCompany } from '@/lib/company-filter.mjs';
import { ChevronRightIcon, CheckCircle2Icon } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Executive — three questions: are we on track, what needs me, is the money moving.
// Row 1 KPIs · Row 2 Milestone Tracker (unchanged) · Row 3 Needs your attention + This month ·
// Row 4 Sales funnel, Cash, Where projects are · then "More detail" (Delivery Forecast and the
// dependency diagnostics, folded). Project numbers follow the top-bar company selector; enquiries
// and approvals are shared across companies. Money comes from getExecutiveBusiness (the same
// order-book maths as the Sales "Order vs Collection" report) — the old ERPNext snapshot row and the
// Workforce tiles are gone (HR has its own page).

function Kpi({ label, value, sub, tone, children }) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-1 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('text-2xl font-semibold leading-tight tnum', tone)}>{value}</p>
        {children}
        {sub && <p className="mt-auto text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Empty({ title, text }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-6 text-center">
      <CheckCircle2Icon className="size-6 text-success" />
      <p className="text-sm font-medium">{title}</p>
      {text && <p className="text-xs text-muted-foreground">{text}</p>}
    </div>
  );
}

function Bar({ label, value, max, right, tone = 'bg-primary' }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs font-medium tnum">{right}</span>
    </div>
  );
}

const DEPT_LABEL = { Installation: 'Service' };
const money = v => (v ? formatMoney(v) : '₹0'); // formatMoney shows "—" for zero; these tiles want a number
const DEPT_ORDER = ['Design', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation'];

export default async function Executive() {
  const user = await getFreshSessionUser();
  if (!isManager(user)) redirect(roleHome(user));

  const company = getSelectedCompany();
  const [{ kpi, delayedBy, topRisks, forecast }, allProjects, dependencyHealth, biz] = await Promise.all([
    getExecutiveSummary(company),
    getProjectsWithStatus(),
    getDependencyHealthSummary(company),
    getExecutiveBusiness(company),
  ]);
  // One entry per commercial order: a split master's units never show as N+1 rows.
  const projects = filterByCompany(allProjects.filter(p => !p.master_project_id), company);
  const deptRows = Object.entries(dependencyHealth.byDepartment).sort((a, b) => b[1] - a[1]);
  const deptMax = deptRows.reduce((a, [, n]) => Math.max(a, n), 0) || 1;
  const delayRows = Object.entries(delayedBy).sort((a, b) => b[1] - a[1]);

  const active = kpi.total - kpi.completed;
  const month = todayISO().slice(0, 7);
  const dueThisMonth = forecast.filter(p => p.roll.code !== 'done' && p.estDispatch && p.estDispatch.startsWith(month))
    .sort((a, b) => a.estDispatch.localeCompare(b.estDispatch));
  const collectedPct = biz.booked ? Math.round((biz.collectedFy / biz.booked) * 100) : 0;

  // Where projects are right now: how many active projects each department currently holds
  // (the same "Currently With" data the Projects list shows).
  const holding = {};
  for (const p of projects) for (const d of p.departmentProgress || []) holding[d.department] = (holding[d.department] || 0) + 1;
  const holdingMax = Math.max(1, ...Object.values(holding));

  const approvals = [
    { n: biz.approvals.discounts, label: 'quotation discount', href: '/sales?tab=quotations' },
    { n: biz.approvals.expenses, label: 'service expense', href: '/approvals' },
    { n: biz.approvals.registrations, label: 'access request', href: '/approvals' },
  ].filter(a => a.n > 0);
  const funnelMax = Math.max(1, ...biz.funnel.map(r => r.value));
  const agingRows = Object.entries(biz.aging).filter(([, v]) => v > 0);
  const agingMax = Math.max(1, ...agingRows.map(([, v]) => v));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Executive Overview" description={company ? `On track, what needs you, and the money · ${company}` : 'On track, what needs you, and the money — across all companies'} />

      {/* Row 1 — KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Active projects" value={active} sub={`${kpi.healthy} on track · ${kpi.delayed} at risk · ${kpi.critical} delayed`}>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="bg-success" style={{ width: `${active ? (kpi.healthy / active) * 100 : 0}%` }} />
            <div className="bg-warning" style={{ width: `${active ? (kpi.delayed / active) * 100 : 0}%` }} />
            <div className="bg-danger" style={{ width: `${active ? (kpi.critical / active) * 100 : 0}%` }} />
          </div>
        </Kpi>
        <Kpi label="Value in progress" value={money(biz.valueInProgress)} sub={kpi.avgDelay ? `Average delay ${kpi.avgDelay}d on late milestones` : 'No late milestones'} />
        <Kpi label="Dispatch due this month" value={dueThisMonth.length} sub={dueThisMonth.length ? `Next: ${dueThisMonth[0].project_no} · ${formatDate(dueThisMonth[0].estDispatch)}` : 'Nothing scheduled'} />
        <Kpi label={`Order book · FY ${biz.fy}`} value={formatMoney(biz.booked)} sub={`${biz.bookedOrders} orders · collected ${formatMoney(biz.collectedFy)} (${collectedPct}%)`} />
        <Kpi label="Outstanding" value={money(biz.outstanding)} tone={biz.outstanding ? 'text-warning' : ''} sub={`${biz.owingCustomers} customer${biz.owingCustomers === 1 ? '' : 's'} · ${money(biz.collectedMonth)} collected this month`} />
      </div>

      {/* Row 2 — Milestone Tracker (unchanged) */}
      <PortfolioDelayTimeline projects={projects} />

      {/* Row 3 — what needs you, and this month */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs Your Attention</CardTitle>
            <CardAction><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium tnum', topRisks.length ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>{topRisks.length + approvals.length}</span></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {approvals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {approvals.map(a => (
                  <Link key={a.label} href={a.href} className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/15">
                    {a.n} {a.label}{a.n === 1 ? '' : 's'} waiting
                  </Link>
                ))}
              </div>
            )}
            {topRisks.length === 0 ? (approvals.length === 0 && <Empty title="Nothing needs you" text="No delayed or blocked projects, no approvals waiting." />) : (
              <ul className="divide-y">
                {topRisks.slice(0, 6).map(r => (
                  <li key={r.id}>
                    <Link href={`/projects/${r.id}`} className="-mx-2 flex items-start gap-3 rounded px-2 py-2.5 transition-colors hover:bg-muted/40">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', r.code === 'blocked' ? 'bg-blocked' : 'bg-danger')} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.project_no} <span className="font-normal text-muted-foreground">· {r.customer_name}</span></p>
                        <p className="truncate text-xs text-muted-foreground">{r.milestone_label}{r.delay_category ? ` · ${r.delay_category}` : ''}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-danger tnum">+{r.impactDays}d</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {topRisks.length > 6 && <p className="text-xs text-muted-foreground">+{topRisks.length - 6} more in the tracker above.</p>}
            {delayRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                Delayed because:
                {delayRows.map(([cat, n]) => <span key={cat} className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">{cat} · {n}</span>)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>This Month</CardTitle>
            <CardAction><span className="text-xs text-muted-foreground">{new Date(`${month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</span></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Dispatches due</p>
              {dueThisMonth.length === 0 ? <p className="py-2 text-sm text-muted-foreground">None scheduled this month.</p> : (
                <ul className="divide-y">
                  {dueThisMonth.slice(0, 5).map(p => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="-mx-2 flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors hover:bg-muted/40">
                        <span className="font-medium">{p.project_no}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.customer_name}</span>
                        <StatusBadge status={p.roll} />
                        <span className="shrink-0 text-xs text-muted-foreground tnum">{formatDate(p.estDispatch)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Largest outstanding</p>
              {biz.topOwing.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Nothing outstanding.</p> : (
                <ul className="divide-y">
                  {biz.topOwing.map(c => (
                    <li key={c.key} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{c.key}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.orders} order{c.orders === 1 ? '' : 's'}</span>
                      <span className="shrink-0 font-medium tnum">{formatMoney(c.outstanding)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4 — business health */}
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Sales Funnel</CardTitle>
            <CardAction><Link href="/sales?tab=leads&view=board" className="text-xs text-muted-foreground hover:text-foreground hover:underline">Open board</Link></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-semibold tnum">{biz.openEnquiries}</p><p className="text-[11px] text-muted-foreground">open enquiries</p></div>
              <div><p className="text-lg font-semibold tnum">{formatMoney(biz.openValue)}</p><p className="text-[11px] text-muted-foreground">open value</p></div>
              <div><p className="text-lg font-semibold tnum">{biz.winRate == null ? '—' : `${biz.winRate}%`}</p><p className="text-[11px] text-muted-foreground">win rate</p></div>
            </div>
            <div className="flex flex-col gap-2 border-t pt-3">
              {biz.funnel.map(r => <Bar key={r.stage} label={r.stage} value={r.value} max={funnelMax} right={`${r.count} · ${formatMoney(r.value)}`} />)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash</CardTitle>
            <CardAction><Link href="/reports?dept=Sales&report=order_book" className="text-xs text-muted-foreground hover:text-foreground hover:underline">Open report</Link></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className="text-lg font-semibold tnum">{money(biz.collectedMonth)}</p><p className="text-[11px] text-muted-foreground">collected this month</p></div>
              <div><p className="text-lg font-semibold tnum">{formatMoney(biz.collectedFy)}</p><p className="text-[11px] text-muted-foreground">collected FY {biz.fy}</p></div>
            </div>
            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Outstanding by age of order</p>
              {agingRows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
                : agingRows.map(([bucket, v]) => <Bar key={bucket} label={bucket} value={v} max={agingMax} right={formatMoney(v)} tone={/180\+|No order/.test(bucket) ? 'bg-danger' : /91/.test(bucket) ? 'bg-warning' : 'bg-primary'} />)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where Projects Are</CardTitle>
            <CardAction><Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground hover:underline">Open projects</Link></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Active projects each department is working on now. A project can be with several at once.</p>
            {DEPT_ORDER.map(d => <Bar key={d} label={DEPT_LABEL[d] || d} value={holding[d] || 0} max={holdingMax} right={`${holding[d] || 0} project${holding[d] === 1 ? '' : 's'}`} />)}
          </CardContent>
        </Card>
      </div>

      {/* More detail — the Delivery Forecast and the dependency diagnostics, folded. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
          More detail — delivery forecast and dependency checks
        </summary>
        <div className="mt-4 flex flex-col gap-4">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dependency-Blocked, by Department</CardTitle></CardHeader>
          <CardContent>
            {deptRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing currently waiting on a dependency.</p>
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
        </div>
      </details>
    </main>
  );
}
