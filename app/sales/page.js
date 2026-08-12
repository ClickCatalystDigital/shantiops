// app/sales/page.js — V3_CHANGES.md §12 Phase 2c. Sidebar-workspace: Leads | Customers |
// Quotations | Sale Orders | Campaigns | Tasks | Team, same gating mechanism as before
// (components/Nav.jsx's inSales). Reports moved to its own top-level tab (§18, app/crm-reports/).
// No PageHeader/<main container> — SalesWorkspace owns the full sidebar layout itself, same as
// CalcWorkspace's page.
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, headDepartments, isPM, roleHome } from '@/lib/auth';
import { getSaleOrders, getLeads, getCustomers, getQuotations, getCampaigns, getFunctionalHeads } from '@/lib/data';
import { queryAll } from '@/lib/db';
import SalesWorkspace from '@/components/SalesWorkspace';

export const dynamic = 'force-dynamic';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export default async function SalesPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Sales') && !canAccessDepartment(user, 'Marketing')) redirect(roleHome(user));

  // Sale-transaction tabs (Customers/Quotations/Sale Orders) stay Sales-only — Marketing shares
  // Leads/Campaigns/Tasks/Team but doesn't own the commercial fulfilment chain. Same
  // "departments the viewer holds" shape as app/pipeline/page.js.
  const departments = isPM(user) ? CRM_DEPARTMENTS : headDepartments(user).filter(d => CRM_DEPARTMENTS.includes(d));

  const [saleOrders, leads, customers, quotations, campaigns, heads, savedViewRows] = await Promise.all([
    getSaleOrders(), getLeads(), getCustomers(), getQuotations(), getCampaigns(),
    getFunctionalHeads(),
    queryAll('SELECT * FROM crm_saved_views WHERE user = ? AND entity = ? ORDER BY pinned DESC, created_at DESC', [user.username, 'leads']),
  ]);
  // "Assign to" pool for Tasks/Team — any active head who holds Sales or Marketing (a dual-dept
  // head shows up for both), same filter-after-getFunctionalHeads pattern app/production/page.js
  // already uses for its own assignee dropdown.
  const crmUsers = heads.filter(h => h.active && h.departments.some(d => CRM_DEPARTMENTS.includes(d)));
  const savedViews = savedViewRows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') }));

  return (
    <SalesWorkspace saleOrders={saleOrders} leads={leads} customers={customers} quotations={quotations} campaigns={campaigns} departments={departments} users={crmUsers} savedViews={savedViews} />
  );
}
