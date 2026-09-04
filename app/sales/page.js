// app/sales/page.js — V3_CHANGES.md §12 Phase 2c. Sidebar-workspace: Leads | Customers |
// Quotations | Sale Orders | Campaigns | Tasks | Team, same gating mechanism as before
// (components/Nav.jsx's inSales). Reports moved to its own top-level tab (§18, app/crm-reports/).
// No PageHeader/<main container> — SalesWorkspace owns the full sidebar layout itself, same as
// CalcWorkspace's page.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getSaleOrders, getLeads, getCustomers, getQuotations, getCampaigns, getFunctionalHeads, getPriceLists, getSalesReturns, getInventoryItems, getSalesInvoices, getSalesCreditNotes } from '@/lib/data';
import { queryAll } from '@/lib/db';
import SalesWorkspace from '@/components/SalesWorkspace';

export const dynamic = 'force-dynamic';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export default async function SalesPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales') && !canAccessDepartment(user, 'Marketing')) redirect(roleHome(user));

  // Sale-transaction tabs (Customers/Quotations/Sale Orders) stay Sales-only — Marketing shares
  // Leads/Campaigns/Tasks/Team but doesn't own the commercial fulfilment chain. Same
  // "departments the viewer holds" shape as app/pipeline/page.js.
  const departments = isPM(user) ? CRM_DEPARTMENTS : headDepartments(user).filter(d => CRM_DEPARTMENTS.includes(d));
  // Sale Order tax % — Accounts owns the real rate, Sales sees it as a label only (direct request).
  // CRM_DEPARTMENTS above deliberately excludes Accounts, so this needs its own check rather than
  // reusing `departments`.
  const canEditSoTax = isPM(user) || canAccessDepartment(user, 'Accounts');

  const [saleOrders, leads, customers, quotations, campaigns, priceLists, returns, inventoryItems, invoices, creditNotes, heads, savedViewRows] = await Promise.all([
    getSaleOrders(), getLeads(), getCustomers(), getQuotations(), getCampaigns(), getPriceLists(), getSalesReturns(), getInventoryItems(),
    getSalesInvoices(), getSalesCreditNotes(),
    getFunctionalHeads(),
    queryAll('SELECT * FROM crm_saved_views WHERE user = ? AND entity = ? ORDER BY pinned DESC, created_at DESC', [user.username, 'leads']),
  ]);
  // "Assign to" pool for Tasks/Team — any active head who holds Sales or Marketing (a dual-dept
  // head shows up for both), same filter-after-getFunctionalHeads pattern app/production/page.js
  // already uses for its own assignee dropdown.
  const crmUsers = heads.filter(h => h.active && h.departments.some(d => CRM_DEPARTMENTS.includes(d)));
  const savedViews = savedViewRows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') }));
  const sp = await searchParams;

  return (
    <SalesWorkspace saleOrders={saleOrders} leads={leads} customers={customers} quotations={quotations} campaigns={campaigns} priceLists={priceLists} returns={returns} inventoryItems={inventoryItems} invoices={invoices} creditNotes={creditNotes} departments={departments} users={crmUsers} savedViews={savedViews} initialTab={sp?.tab} canEditSoTax={canEditSoTax} />
  );
}
