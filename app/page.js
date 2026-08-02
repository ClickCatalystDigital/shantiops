import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyWork, getBomWork, getDepartmentTasks, getStageBottlenecks, getWaitingList, getSourcingItems } from '@/lib/data';
import { getSessionUser, isCustomer, isManager, isHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import StatusBadge from '@/components/StatusBadge';
import DispatchBoard from '@/components/DispatchBoard';
import TicketsPanel from '@/components/TicketsPanel';
import ProcurementQueue from '@/components/ProcurementQueue';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { ArrowRightIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

function StatChip({ label, value, dot }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="font-semibold tnum">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export default async function Home({ searchParams }) {
  const user = getSessionUser();
  if (isCustomer(user)) redirect(roleHome(user));

  if (isHead(user) && headDepartments(user).length === 0) {
    return (
      <main className="container py-8">
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No departments assigned yet — contact your PM.
        </CardContent></Card>
      </main>
    );
  }

  // A ?dept= that this user has no business seeing (typed in, or linked from somewhere that
  // shows a task touching a department they're not part of — e.g. the Tasks calendar) falls
  // back to their own combined view instead of leaking that department's Waiting-on/task data.
  const rawDeptFilter = searchParams?.dept || null;
  const deptFilter = rawDeptFilter && canAccessDepartment(user, rawDeptFilter) ? rawDeptFilter : null;
  const manager = isManager(user);
  // The cross-department task card is department-scoped like the rest of Operations: whatever
  // department(s) this view is currently showing. PMs get no section here (deptsToShow is always
  // [] for them) — their cross-department raise/oversight surface is the project page's
  // all-departments tab strip instead (app/projects/[id]/page.js), which they always get.
  const deptsToShow = manager ? [] : (deptFilter ? [deptFilter] : headDepartments(user));

  // Dispatch department view = the packing board (§ "packing within department").
  if (deptFilter === 'Dispatch') {
    const dispatchTasks = deptsToShow.length ? await getDepartmentTasks('Dispatch') : [];
    // Cross-project BOM items, so a Dispatch head raising a "Cancel BOM item" request from
    // Operations gets the same picker the project page's Raise dialog offers.
    const sourcingItems = deptsToShow.length ? await getSourcingItems() : [];
    return (
      <main className="container flex flex-col gap-6 py-8">
        <PageHeader title="Packing &amp; Dispatch"
          description="Packing lists generated from each project's BOM — Pending → Ready → Dispatched." />
        <DispatchBoard />
        {deptsToShow.length > 0 && <TicketsPanel department="Dispatch" tasks={dispatchTasks} bom={sourcingItems} canRaise />}
      </main>
    );
  }

  const groups = await getMyWork(user, deptFilter);
  const tasksByDept = deptsToShow.length
    ? await Promise.all(deptsToShow.map(d => getDepartmentTasks(d)))
    : [];
  // Cross-project BOM items (§5c) — feeds both the Procurement queue card below and every
  // TicketsPanel's "Cancel BOM item" picker, the same way DepartmentPanel threads a project's own
  // bom into TicketsPanel on the project page.
  const sourcingItems = deptsToShow.length ? await getSourcingItems() : [];
  const bottlenecks = deptsToShow.includes('Production') ? await getStageBottlenecks('Production') : [];
  const waitingByDept = deptsToShow.length
    ? await Promise.all(deptsToShow.map(d => getWaitingList(d)))
    : [];
  // Open Master-BOM work for BOM-owning departments (Engineering: missing BOMs; Procurement /
  // Stores / Production: items not yet closed). Fills the once-empty Engineering attention list.
  const bomWork = deptFilter && deptFilter !== 'Engineering' && !['Procurement', 'Stores', 'Production'].includes(deptFilter)
    ? [] : await getBomWork(user);
  const title = deptFilter || (manager ? "Today's Factory" : null);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const allItems = groups.flatMap(g => g.items);
  const chips = {
    overdue: allItems.filter(m => m.eff.code === 'overdue').length,
    blocked: allItems.filter(m => m.eff.code === 'blocked').length,
    dueSoon: allItems.filter(m => m.eff.code === 'due_now' || m.eff.code === 'due_soon').length,
  };

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title={title}
        description={`${manager ? 'Everything needing attention across all projects' : `Assigned to @${user?.username}`} · ${total} item${total !== 1 ? 's' : ''}`}>
        {manager && (
          <Button asChild variant="outline" size="sm">
            <Link href="/executive">Executive view <ArrowRightIcon data-icon="inline-end" /></Link>
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <StatChip label="overdue" value={chips.overdue} dot="bg-danger" />
        <StatChip label="blocked" value={chips.blocked} dot="bg-blocked" />
        <StatChip label="due soon" value={chips.dueSoon} dot="bg-warning" />
      </div>

      {bomWork.length > 0 && (
        <Card>
          <CardHeader className="py-4"><CardTitle className="text-base">Master BOM</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y pt-0">
            {bomWork.map(w => (
              <Link key={w.id} href={`/projects/${w.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                <span className="font-medium text-primary">{w.project_no}</span>
                <span className="text-muted-foreground">{w.customer_name}</span>
                <span className="ml-auto text-xs tnum">
                  {w.total === 0
                    ? <span className="text-warning font-medium">BOM not uploaded</span>
                    : <span className="text-muted-foreground">{w.open} open item{w.open !== 1 ? 's' : ''}</span>}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {groups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nothing needs attention right now. 🎉
        </CardContent></Card>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {groups.map(g => (
            <Card key={g.items[0].project_id}>
              <CardHeader className="py-4">
                <CardTitle className="text-base">
                  <Link href={`/projects/${g.items[0].project_id}`} className="text-primary hover:underline">{g.project_no}</Link>
                  <span className="text-muted-foreground font-normal"> · {g.customer_name}</span>
                </CardTitle>
                <CardAction className="text-xs text-muted-foreground tnum">{g.items.length} item{g.items.length !== 1 ? 's' : ''}</CardAction>
              </CardHeader>
              <CardContent className="flex flex-col divide-y pt-0">
                {g.items.map(m => (
                  <Link key={m.id} href={`/projects/${m.project_id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                    <StatusBadge status={m.eff} />
                    <span className="font-medium">{m.milestone_label}</span>
                    {manager && <span className="text-xs text-muted-foreground">{m.assignee ? `@${m.assignee}` : 'Unassigned'}</span>}
                    <span className="ml-auto text-xs text-muted-foreground tnum">{formatDate(m.planned_end)}</span>
                    {m.delay_reason && <span className="w-full text-xs text-warning">⚠ {m.delay_reason}</span>}
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {bottlenecks.length > 0 && (
        <Card>
          <CardHeader className="py-4"><CardTitle className="text-base">Stuck in Production</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y pt-0">
            {bottlenecks.map(b => (
              <div key={b.label} className="flex items-center justify-between py-2.5 text-sm">
                <span>{b.label}</span>
                <span className="text-muted-foreground tnum">{b.count} project{b.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {deptsToShow.includes('Procurement') && sourcingItems.length > 0 && (
        <ProcurementQueue bom={sourcingItems} tasks={tasksByDept[deptsToShow.indexOf('Procurement')]} />
      )}

      {deptsToShow.map((d, i) => {
        const groups = Object.entries(waitingByDept[i]);
        if (groups.length === 0) return null;
        return (
          <Card key={`waiting-${d}`}>
            <CardHeader className="py-4"><CardTitle className="text-base">Waiting on — {d}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {groups.map(([category, items]) => (
                <div key={category}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {category} · {items.length}
                  </p>
                  <div className="flex flex-col divide-y">
                    {items.map(m => (
                      <Link key={m.id} href={`/projects/${m.project_id}`}
                        className="flex items-center gap-2 py-1.5 text-sm transition-colors hover:bg-muted/40 -mx-2 px-2 rounded">
                        <span className="font-medium text-primary">{m.project_no}</span>
                        <span className="truncate text-muted-foreground">{m.milestone_label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {deptsToShow.map((d, i) => (
        <TicketsPanel key={d} title={d} department={d} canRaise tasks={tasksByDept[i]} bom={sourcingItems} />
      ))}
    </main>
  );
}
