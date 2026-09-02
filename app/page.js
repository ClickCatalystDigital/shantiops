// app/page.js

import Link from 'next/link';
import { redirect } from 'next/navigation';
import ProductionTodayPage from './production/page';
import { getMyWork, getBomWork, bucketBomWork, getDepartmentTasks, getStageBottlenecks, getSourcingItems, getProcurementFlowCounts, getDesignFlowCounts, getDesignWork, getSalesFlowCounts, getStoresFlowCounts, getProductionFlowCounts, getDispatchFlowCounts, getDispatchWork, getInstallationFlowCounts, getHrFlowCounts, getEngineeringFlowCounts, getQcFlowCounts, getAccountsFlowCounts } from '@/lib/data';
import { getFreshSessionUser, isCustomer, isManager, isHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import StatusBadge from '@/components/StatusBadge';
import TicketsPanel from '@/components/TicketsPanel';
import ProcurementFlow from '@/components/ProcurementFlow';
import SalesFlow from '@/components/SalesFlow';
import StoresFlow from '@/components/StoresFlow';
import ProductionFlow from '@/components/ProductionFlow';
import DispatchFlow from '@/components/DispatchFlow';
import InstallationFlow from '@/components/InstallationFlow';
import HrFlow from '@/components/HrFlow';
import EngineeringFlow from '@/components/EngineeringFlow';
import QcFlow from '@/components/QcFlow';
import AccountsFlow from '@/components/AccountsFlow';
import DesignFlow from '@/components/DesignFlow';
import OperationsFilterBar from '@/components/OperationsFilterBar';
import MasterWorkTable from '@/components/MasterWorkTable';
import OperationsAttentionSection from '@/components/OperationsAttentionSection';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { ArrowRightIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Departments on the shared unified Operations card (operations-tab-changes.md, generalizing
// DESIGN-OPS-REDESIGN.md's pattern). A single-department view of any of these hides the generic
// Open Actions grid below — the card's own table Bottleneck column + the project page's own Open
// Actions card already cover that ground, same precedent Design's card set. PM/multi-department
// views keep the grid (still the only cross-department aggregate there).
const UNIFIED_DEPTS = ['Procurement', 'Stores', 'Production', 'Design', 'Engineering', 'Dispatch'];

// Column specs for the four BOM-owning departments' unified table — plain data, not render
// functions (this file is a Server Component; a function prop can't cross into the Client
// Component tree). `field: 'progress'` reads the `{ done, total }` pair every BOM-bucketed work
// row is normalized to below.
const BOM_WORK_COLUMNS = [
  { key: 'progress', label: 'Progress', width: 'w-40', kind: 'progress', field: 'progress' },
  { key: 'bottleneck', label: 'Bottleneck', width: 'w-36', kind: 'bottleneckChip' },
];
const DESIGN_WORK_COLUMNS = [
  { key: 'progress', label: 'Design Progress', width: 'w-40', kind: 'progress', field: 'designProgress' },
  { key: 'bottleneck', label: 'Bottleneck', width: '', kind: 'text', field: 'bottleneck' },
  { key: 'calc', label: 'Calc Status', width: 'w-28', kind: 'ratioText', field: 'calcStatus' },
  { key: 'drawings', label: 'Drawings', width: 'w-24', kind: 'ratioText', field: 'drawings' },
];
const DISPATCH_WORK_COLUMNS = [
  { key: 'progress', label: 'Dispatch Progress', width: 'w-40', kind: 'progress', field: 'dispatchProgress' },
  { key: 'bottleneck', label: 'Bottleneck', width: '', kind: 'text', field: 'bottleneck' },
  { key: 'lists', label: 'Packing Lists', width: 'w-32', kind: 'ratioText', field: 'listsStatus' },
];

// Same outgoing/incoming split every unified card uses — pulled out once instead of copied per
// department (this used to be five near-identical inline IIFEs).
function splitIncidents(tasks, dept) {
  return {
    outgoing: tasks.filter(t => t.from_department === dept && !t.bom_item_id),
    incoming: tasks.filter(t => t.department === dept && t.from_department && t.from_department !== dept && !t.bom_item_id),
  };
}

export async function OperationsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!user) redirect('/login');
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
  const isUnifiedOnlyView = deptsToShow.length === 1 && UNIFIED_DEPTS.includes(deptsToShow[0]);

  const groups = await getMyWork(user, deptFilter);
  const tasksByDept = deptsToShow.length
    ? await Promise.all(deptsToShow.map(d => getDepartmentTasks(d)))
    : [];
  // Cross-project BOM items (§5c) — feeds every TicketsPanel's "Cancel BOM item" picker, the same
  // way DepartmentPanel threads a project's own bom into TicketsPanel on the project page.
  const sourcingItems = deptsToShow.length ? await getSourcingItems() : [];
  const bottlenecks = deptsToShow.includes('Production') ? await getStageBottlenecks('Production') : [];
  // Sales/Installation/HR/QC/Accounts pipeline glances — outside this pass's unified-card rollout
  // (no per-project master table exists for any of them yet, see operations-tab-changes.md), so
  // they keep their original standalone-Card treatment.
  const salesFlow = deptsToShow.includes('Sales') ? await getSalesFlowCounts() : null;
  const installationFlow = deptsToShow.includes('Installation') ? await getInstallationFlowCounts() : null;
  const hrFlow = deptsToShow.includes('HR') ? await getHrFlowCounts() : null;
  const qcFlow = deptsToShow.includes('QC') ? await getQcFlowCounts() : null;
  const accountsFlow = deptsToShow.includes('Accounts') ? await getAccountsFlowCounts() : null;

  // Open Master-BOM work for the four BOM-owning departments — one shared query, bucketed per
  // department below (bucketBomWork, lib/data.js) rather than everyone sharing one combined table.
  const bomWork = deptFilter && deptFilter !== 'Engineering' && !['Procurement', 'Stores', 'Production'].includes(deptFilter)
    ? [] : await getBomWork(user);

  // Assemble the unified-card list (operations-tab-changes.md) — one entry per department in
  // deptsToShow that's on the shared pattern, in a fixed order, each self-contained: its own flow,
  // its own outgoing/incoming split, its own filtered table.
  const cards = [];
  if (deptsToShow.includes('Procurement')) {
    const counts = await getProcurementFlowCounts();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Procurement')] || [], 'Procurement');
    const work = bucketBomWork(bomWork, 'Procurement').map(w => ({ ...w, progress: { done: w.closed, total: w.total } }));
    cards.push({
      dept: 'Procurement', flow: <ProcurementFlow counts={counts} bare />, outgoing, incoming,
      work, columns: BOM_WORK_COLUMNS, sourcingItems, emptyMessage: 'Nothing open in Procurement.',
      href: '/procurement', linkLabel: 'Open Procurement workspace →',
    });
  }
  if (deptsToShow.includes('Stores')) {
    const counts = await getStoresFlowCounts();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Stores')] || [], 'Stores');
    const work = bucketBomWork(bomWork, 'Stores').map(w => ({ ...w, progress: { done: w.closed, total: w.total } }));
    cards.push({
      dept: 'Stores', flow: <StoresFlow counts={counts} bare />, outgoing, incoming,
      work, columns: BOM_WORK_COLUMNS, sourcingItems, emptyMessage: 'Nothing in transit right now.',
      href: '/stores', linkLabel: 'Open Stores workspace →',
    });
  }
  if (deptsToShow.includes('Production')) {
    const counts = await getProductionFlowCounts();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Production')] || [], 'Production');
    const work = bucketBomWork(bomWork, 'Production').map(w => ({ ...w, progress: { done: w.closed, total: w.total } }));
    cards.push({
      dept: 'Production', flow: <ProductionFlow counts={counts} bare />, outgoing, incoming,
      work, columns: BOM_WORK_COLUMNS, sourcingItems, emptyMessage: 'Nothing received and awaiting production yet.',
      href: '/production/workers', linkLabel: 'Open Job Card workspace →',
    });
  }
  if (deptsToShow.includes('Engineering')) {
    const counts = await getEngineeringFlowCounts();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Engineering')] || [], 'Engineering');
    const work = bucketBomWork(bomWork, 'Engineering').map(w => ({ ...w, progress: { done: w.closed, total: w.total } }));
    cards.push({
      dept: 'Engineering', flow: <EngineeringFlow counts={counts} bare />, outgoing, incoming,
      work, columns: BOM_WORK_COLUMNS, sourcingItems, emptyMessage: 'No missing BOMs.',
      href: '/engineering', linkLabel: 'Open Engineering workspace →',
    });
  }
  if (deptsToShow.includes('Design')) {
    const counts = await getDesignFlowCounts();
    const work = await getDesignWork();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Design')] || [], 'Design');
    cards.push({
      dept: 'Design', flow: <DesignFlow counts={counts} bare />, outgoing, incoming,
      work, columns: DESIGN_WORK_COLUMNS, sourcingItems, emptyMessage: 'No active design work yet.',
      href: '/calc', linkLabel: 'Open Calc Sheets →',
    });
  }
  if (deptsToShow.includes('Dispatch')) {
    const counts = await getDispatchFlowCounts();
    const work = await getDispatchWork();
    const { outgoing, incoming } = splitIncidents(tasksByDept[deptsToShow.indexOf('Dispatch')] || [], 'Dispatch');
    cards.push({
      dept: 'Dispatch', flow: <DispatchFlow counts={counts} bare />, outgoing, incoming,
      work, columns: DISPATCH_WORK_COLUMNS, sourcingItems, emptyMessage: 'No active dispatch work yet.',
      href: '/dispatch', linkLabel: 'Open Dispatch →',
    });
  }

  // PM/admin's "Today's Factory" never populates deptsToShow (see comment above — their raise/
  // oversight surface is the project page instead), so the per-department cards above never build
  // for them. They still get the combined Master BOM table — every open BOM item across all 4
  // BOM-owning departments, unbucketed — the same visibility MasterBomTable gave them before this
  // pass, just on the shared table component now.
  const pmBomWork = manager && bomWork.length
    ? bomWork.map(w => ({ ...w, progress: { done: w.closed, total: w.total } }))
    : null;

  const title = deptFilter || (manager ? "Today's Factory" : null);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  // Chip counts now live inside OperationsAttentionSection/OperationsFilterBar (they need them
  // anyway to build the pill options), so the standalone `chips` calc here is gone.
  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title={title}
        description={`${manager ? 'Everything needing attention across all projects' : `Assigned to @${user?.username}`} `}>
        {/* · ${total} item${total !== 1 ? 's' : ''}`}> */}
        {manager && (
          <Button asChild variant="outline" size="sm">
            <Link href="/executive">Executive view <ArrowRightIcon data-icon="inline-end" /></Link>
          </Button>
        )}
      </PageHeader>

      {/* Unified cards (flow + incidents + table each) — highest-value thing on this page for
          "where do things stand," so they go first, one shared pill row above all of them. */}
      {cards.length > 0 && <OperationsFilterBar groups={groups} cards={cards} />}

      {/* Sales/Installation/HR/QC/Accounts — not on the unified-card pattern yet (no per-project
          master table for any of them), so they keep their original standalone flow cards. */}
      {salesFlow && <SalesFlow counts={salesFlow} />}
      {installationFlow && <InstallationFlow counts={installationFlow} />}
      {hrFlow && <HrFlow counts={hrFlow} />}
      {qcFlow && <QcFlow counts={qcFlow} />}
      {accountsFlow && <AccountsFlow counts={accountsFlow} />}

      {pmBomWork && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-base">Master BOM</CardTitle>
            <CardAction className="text-xs text-muted-foreground tnum">{pmBomWork.length} project{pmBomWork.length !== 1 ? 's' : ''}</CardAction>
          </CardHeader>
          <CardContent className="pt-0">
            <MasterWorkTable work={pmBomWork} columns={BOM_WORK_COLUMNS} emptyMessage="Nothing open." />
          </CardContent>
        </Card>
      )}

      {/* "Open Actions" (renamed from "Needs Attention") — each project card now splits into
          Urgent (not yet delayed, closest deadline first) on top and Needs Attention (already
          overdue/blocked) below, instead of one severity-sorted list. */}
      {!isUnifiedOnlyView && <OperationsAttentionSection groups={groups} manager={manager} />}

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

      {/* Cross-department "incidents" card per department — departments on the unified-card
          pattern get their own outgoing/incoming split inside their card above instead. */}
      {deptsToShow.map((d, i) => !UNIFIED_DEPTS.includes(d) && (
        <TicketsPanel key={d} title={d} department={d} canRaise tasks={tasksByDept[i]} bom={sourcingItems} />
      ))}
    </main>
  );
}

// `/` is the original department Home/Tasks experience. The Operations dashboard above keeps its
// original UI and is exposed at `/ops`; this module remains the shared implementation boundary.
export default ProductionTodayPage;
