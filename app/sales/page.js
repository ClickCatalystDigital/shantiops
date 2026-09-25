// app/sales/page.js — V3_CHANGES.md §12 Phase 2c. Sidebar-workspace: Leads | Customers |
// Quotations | Sale Orders | Tasks | Team. Reports moved to its own top-level tab (§18,
// app/crm-reports/). No PageHeader/<main container> — SalesWorkspace owns the full sidebar layout
// itself, same as CalcWorkspace's page.
//
// Sales-only now (2026-09-24) — Marketing split off onto its own tab/URL/component
// (/market, components/MarketingWorkspace.jsx), so this page no longer needs the
// Sales-or-Marketing dual-department resolution it used to carry.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, isPM, roleHome } from '@/lib/auth';
import { getSaleOrders, getLeads, getCustomers, getQuotations, getFunctionalHeads, getPriceLists, getSalesReturns, getInventoryItems, getSalesInvoices, getSalesCreditNotes, getActiveProjectsList, getScopeOfSupply, getSalePayments, getBranches, getSalesProducts, getSalesTargets, getSalesStages } from '@/lib/data';
import { queryAll } from '@/lib/db';
import SalesWorkspace from '@/components/SalesWorkspace';

export const dynamic = 'force-dynamic';

export default async function SalesPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales')) redirect(roleHome(user));

  // Sale Order tax % — Accounts owns the real rate, Sales sees it as a label only (direct request).
  const canEditSoTax = isPM(user) || canAccessDepartment(user, 'Accounts');
  const sp = await searchParams;
  // Scope of Supply (2026-09-18) — the same document/picker Design/Engineering already have on
  // /projects (components/ScopeOfSupplySection.jsx, reused verbatim), just with money visible:
  // Sales owns pricing, and Design/Engineering's own copy of this panel now hides it.
  const scopeProjectId = sp?.project ? Number(sp.project) : null;

  const [saleOrders, leads, customers, quotations, priceLists, returns, inventoryItems, invoices, creditNotes, heads, savedViewRows, projects, scopeOfSupply, salePayments, branches, salesProducts, salesTargets, stages] = await Promise.all([
    getSaleOrders(), getLeads(), getCustomers(), getQuotations(),
    getPriceLists(), getSalesReturns(), getInventoryItems(),
    getSalesInvoices(), getSalesCreditNotes(),
    getFunctionalHeads(),
    queryAll('SELECT * FROM crm_saved_views WHERE user = ? AND entity = ? ORDER BY pinned DESC, created_at DESC', [user.username, 'leads']),
    getActiveProjectsList(),
    scopeProjectId ? getScopeOfSupply(scopeProjectId) : [],
    getSalePayments(),
    getBranches(), getSalesProducts(), getSalesTargets(), getSalesStages(),
  ]);
  // "Assign to" pool for Tasks/Team — any active head who holds Sales, same filter-after-
  // getFunctionalHeads pattern app/production/page.js already uses for its own assignee dropdown.
  const crmUsers = heads.filter(h => h.active && h.departments.includes('Sales'));
  const savedViews = savedViewRows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') }));

  return (
    <SalesWorkspace saleOrders={saleOrders} leads={leads} customers={customers} quotations={quotations} priceLists={priceLists} returns={returns} inventoryItems={inventoryItems} invoices={invoices} creditNotes={creditNotes} departments={['Sales']} users={crmUsers} savedViews={savedViews} initialTab={sp?.tab} canEditSoTax={canEditSoTax} projects={projects} scopeOfSupply={scopeOfSupply} initialScopeProject={sp?.project} salePayments={salePayments} branches={branches} salesProducts={salesProducts} salesTargets={salesTargets} stages={stages} />
  );
}
