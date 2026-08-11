// app/sales/page.js — V3_CHANGES.md §12 Phase 2c. Tabbed: Leads | Customers | Quotations |
// Sale Orders | Campaigns, same gating mechanism as before (components/Nav.jsx's inSales).
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getSaleOrders, getLeads, getCustomers, getQuotations, getCampaigns } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import SalesWorkspace from '@/components/SalesWorkspace';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'Sales')) redirect(roleHome(user));

  const [saleOrders, leads, customers, quotations, campaigns] = await Promise.all([
    getSaleOrders(), getLeads(), getCustomers(), getQuotations(), getCampaigns(),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Sales" description="Leads, customers, quotations and sale orders" />
      <SalesWorkspace saleOrders={saleOrders} leads={leads} customers={customers} quotations={quotations} campaigns={campaigns} />
    </main>
  );
}
