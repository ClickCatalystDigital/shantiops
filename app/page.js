// app/page.js

import Link from 'next/link';
import { redirect } from 'next/navigation';
import ProductionTodayPage from './production/page';
import { getMyWork, getBomWork, getDepartmentTasks, getStageBottlenecks, getSourcingItems, getProcurementFlowCounts, getDesignFlowCounts, getDesignWork, getSalesFlowCounts, getStoresFlowCounts } from '@/lib/data';
import { getFreshSessionUser, isCustomer, isManager, isHead, headDepartments, canAccessDepartment, roleHome } from '@/lib/auth';
import StatusBadge from '@/components/StatusBadge';
import DispatchBoard from '@/components/DispatchBoard';
import TicketsPanel from '@/components/TicketsPanel';
import ProcurementFlow from '@/components/ProcurementFlow';
import SalesFlow from '@/components/SalesFlow';
import StoresFlow from '@/components/StoresFlow';
import MasterBomTable from '@/components/MasterBomTable';
import DesignOperationsSection from '@/components/DesignOperationsSection';
import OperationsAttentionSection from '@/components/OperationsAttentionSection';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { ArrowRightIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

// function StatChip({ label, value, dot }) {
//   return (
//     <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm">
//       <span className={`size-2 rounded-full ${dot}`} />
//       <span className="font-semibold tnum">{value}</span>
//       <span className="text-muted-foreground">{label}</span>
//     </div>
//   );
// }

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
  // Design's Operations view is now one unified card (DesignOperationsCard) whose master table +
  // the project page's own Open Actions card already surface what the generic per-project
  // "needs attention" grid below would otherwise duplicate — see DESIGN-OPS-REDESIGN.md. Other
  // departments haven't had this pass yet, so the grid stays for them.
  const isDesignOnlyView = deptsToShow.length === 1 && deptsToShow[0] === 'Design';

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
  // Cross-project BOM items (§5c) — feeds every TicketsPanel's "Cancel BOM item" picker, the same
  // way DepartmentPanel threads a project's own bom into TicketsPanel on the project page.
  const sourcingItems = deptsToShow.length ? await getSourcingItems() : [];
  const bottlenecks = deptsToShow.includes('Production') ? await getStageBottlenecks('Production') : [];
  // Procurement's pipeline glance (§2 of the redesign) — replaces the old Sourcing/PO-placed/
  // In-transit tiles. Positioned right after the stat chips, ahead of the per-project breakdown
  // below, which is the least useful thing on this page for a quick "where do things stand" glance.
  const procurementFlow = deptsToShow.includes('Procurement') ? await getProcurementFlowCounts() : null;
  // Sales' pipeline glance (STORES-SALES-CHANGES.md follow-up) — same slot/precedent as Procurement's.
  const salesFlow = deptsToShow.includes('Sales') ? await getSalesFlowCounts() : null;
  // Stores' pipeline glance (STORES-SALES-CHANGES.md follow-up) — same slot/precedent as Procurement's.
  const storesFlow = deptsToShow.includes('Stores') ? await getStoresFlowCounts() : null;
  // Design's pipeline glance (§E) — same slot/precedent as Procurement's.
  const designFlow = deptsToShow.includes('Design') ? await getDesignFlowCounts() : null;
  const designWork = deptsToShow.includes('Design') ? await getDesignWork() : [];
  // Same direction-split the old standalone incident cards used, just precomputed here now that
  // DesignOperationsCard needs both lists as props instead of an inline IIFE further down.
  const designTasks = deptsToShow.includes('Design') ? (tasksByDept[deptsToShow.indexOf('Design')] || []) : [];
  const designOutgoing = designTasks.filter(t => t.from_department === 'Design' && !t.bom_item_id);
  const designIncoming = designTasks.filter(t => t.department === 'Design' && t.from_department && t.from_department !== 'Design' && !t.bom_item_id);
  // Open Master-BOM work for BOM-owning departments (Engineering: missing BOMs; Procurement /
  // Stores / Production: items not yet closed). Fills the once-empty Engineering attention list.
  const bomWork = deptFilter && deptFilter !== 'Engineering' && !['Procurement', 'Stores', 'Production'].includes(deptFilter)
    ? [] : await getBomWork(user);
  const title = deptFilter || (manager ? "Today's Factory" : null);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  // Chip counts now live inside OperationsAttentionSection (it needs them anyway to build the
  // pill options), so the standalone `chips` calc here is gone — nothing else on the page used it.
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

      {/* Procurement's pipeline glance sits right after the KPI chips — ahead of the per-project
          breakdown below, which is the least useful thing here for a quick status check. */}
      {procurementFlow && <ProcurementFlow counts={procurementFlow} />}
      {salesFlow && <SalesFlow counts={salesFlow} />}
      {storesFlow && <StoresFlow counts={storesFlow} />}
      {designFlow && (
        <DesignOperationsSection groups={groups} counts={designFlow} designWork={designWork}
          outgoing={designOutgoing} incoming={designIncoming} sourcingItems={sourcingItems} />
      )}

      <MasterBomTable bomWork={bomWork} />

      {/* "Open Actions" (renamed from "Needs Attention") — each project card now splits into
          Urgent (not yet delayed, closest deadline first) on top and Needs Attention (already
          overdue/blocked) below, instead of one severity-sorted list. */}
      {!isDesignOnlyView && <OperationsAttentionSection groups={groups} manager={manager} />}

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

      {/* Cross-department "incidents" card per department. Procurement is special-cased below into
          two direction-split cards (V2-CHANGES.md Group 4b — moved back here from the Requests tab,
          which now only holds the New-item/Cancel acceptance inbox). "Waiting on" (delay_category
          grouping) stays removed — near-unused across the whole app and redundant with Open Actions. */}
      {deptsToShow.map((d, i) => d !== 'Procurement' && d !== 'Design' && d !== 'Stores' && (
        <TicketsPanel key={d} title={d} department={d} canRaise tasks={tasksByDept[i]} bom={sourcingItems} />
      ))}

      {/* Procurement's incident cards, direction-split (V2-CHANGES.md Group 4b / D15). Same
          from_department filter the Requests page used; reuses the already-fetched Procurement
          tasks rather than a second query. Outgoing = raised by Procurement toward others; Incoming
          = raised toward Procurement by others. bom_item_id-linked tasks are cancel-requests, shown
          in the Requests inbox / Procurement queue, not here. */}
      {(() => {
        const pi = deptsToShow.indexOf('Procurement');
        if (pi === -1) return null;
        const procTasks = tasksByDept[pi] || [];
        const outgoing = procTasks.filter(t => t.from_department === 'Procurement' && !t.bom_item_id);
        const incoming = procTasks.filter(t => t.department === 'Procurement' && t.from_department && t.from_department !== 'Procurement' && !t.bom_item_id);
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <TicketsPanel title="Outgoing Incidents" department="Procurement" canRaise showDepartment
              tasks={outgoing} bom={sourcingItems} />
            <TicketsPanel title="Incoming Incidents" department="Procurement" tasks={incoming} />
          </div>
        );
      })()}

      {/* Stores' incident cards, direction-split — same exact pattern as Procurement's above,
          reusing the already-fetched Stores tasks. TicketsPanel's raise dialog already fires a
          real notification to the target department (same mechanism every other Raise does), so
          this gets Stores real incoming/outgoing notifications for free — nothing extra to wire. */}
      {(() => {
        const si = deptsToShow.indexOf('Stores');
        if (si === -1) return null;
        const storesTasks = tasksByDept[si] || [];
        const outgoing = storesTasks.filter(t => t.from_department === 'Stores' && !t.bom_item_id);
        const incoming = storesTasks.filter(t => t.department === 'Stores' && t.from_department && t.from_department !== 'Stores' && !t.bom_item_id);
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <TicketsPanel title="Outgoing Incidents" department="Stores" canRaise showDepartment
              tasks={outgoing} bom={sourcingItems} />
            <TicketsPanel title="Incoming Incidents" department="Stores" tasks={incoming} />
          </div>
        );
      })()}

      {/* Design's incident cards, direction-split (§E) — same exact pattern as Procurement's just
          above, reusing the already-fetched Design tasks rather than a second query. */}
      {/* {(() => {
        const di = deptsToShow.indexOf('Design');
        if (di === -1) return null;
        const designTasks = tasksByDept[di] || [];
        const outgoing = designTasks.filter(t => t.from_department === 'Design' && !t.bom_item_id);
        const incoming = designTasks.filter(t => t.department === 'Design' && t.from_department && t.from_department !== 'Design' && !t.bom_item_id);
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <TicketsPanel title="Outgoing Incidents" department="Design" canRaise showDepartment
              tasks={outgoing} bom={sourcingItems} />
            <TicketsPanel title="Incoming Incidents" department="Design" tasks={incoming} />
          </div>
        );
      })()} */}
    </main>
  );
}

// `/` is the original department Home/Tasks experience. The Operations dashboard above keeps its
// original UI and is exposed at `/ops`; this module remains the shared implementation boundary.
export default ProductionTodayPage;
