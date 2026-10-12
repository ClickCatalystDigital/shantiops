// app/sales/page.js — V3_CHANGES.md §12 Phase 2c. Sidebar-workspace: Leads | Customers |
// Quotations | Sale Orders | Tasks | Team. Reports moved to its own top-level tab (§18,
// app/crm-reports/). No PageHeader/<main container> — SalesWorkspace owns the full sidebar layout
// itself, same as CalcWorkspace's page.
//
// Sales-only now (2026-09-24) — Marketing split off onto its own tab/URL/component
// (/market, components/MarketingWorkspace.jsx), so this page no longer needs the
// Sales-or-Marketing dual-department resolution it used to carry.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome, isDepartmentHead } from '@/lib/auth';
import { getSelectedCompany } from '@/lib/company-filter-server';
import { filterByCompany } from '@/lib/company-filter.mjs';
import { salesScope } from '@/lib/sales-visibility';
import { scopeSalesLists } from '@/lib/sales-visibility.mjs';
import { getSaleOrders, getLeads, getQuotations, getFunctionalHeads, getPriceLists, getSalesReturns, getTradeRequests, getInventoryItems, getSalesInvoices, getSalesCreditNotes, getSalePayments, getBranches, getSalesProducts, getSalesTargets, getSalesStages } from '@/lib/data';
import { queryAll } from '@/lib/db';
import { packRows } from '@/lib/row-pack.mjs';
import SalesWorkspace from '@/components/SalesWorkspace';
import { SALES_TAB_DATA, salesTabKey, keysToLoad } from '@/lib/sales-tab-data.mjs';

export const dynamic = 'force-dynamic';

export default async function SalesPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales')) redirect(roleHome(user));

  const sp = await searchParams;

  // Only the open tab's large lists are loaded and sent (lib/sales-tab-data.mjs); a tab switch asks
  // the server again (SalesWorkspace), so every router.refresh() after a save reloads that tab.
  const tabKey = salesTabKey(sp?.tab);
  const sendKeys = SALES_TAB_DATA[tabKey] || [];
  const me = salesScope(user);
  const want = keysToLoad(sendKeys, !!me);
  const LOADERS = {
    saleOrders: getSaleOrders, leads: getLeads, quotations: getQuotations, priceLists: getPriceLists,
    returns: getSalesReturns, inventoryItems: getInventoryItems, invoices: getSalesInvoices,
    creditNotes: getSalesCreditNotes, salePayments: getSalePayments, salesProducts: getSalesProducts,
    salesTargets: getSalesTargets, tradeRequests: getTradeRequests,
  };
  const loaded = Object.fromEntries(await Promise.all(Object.entries(LOADERS)
    .map(async ([k, fn]) => [k, want.has(k) ? await fn() : []])));
  let { saleOrders, leads, quotations, priceLists, returns, inventoryItems, invoices, creditNotes, salePayments, salesProducts, salesTargets, tradeRequests } = loaded;
  const customers = []; // searched via API (CustomerPicker), not preloaded
  const [heads, savedViewRows, branches, stages] = await Promise.all([
    getFunctionalHeads(),
    queryAll('SELECT * FROM crm_saved_views WHERE user = ? AND entity = ? ORDER BY pinned DESC, created_at DESC', [user.username, 'leads']),
    getBranches(), getSalesStages(),
  ]);
  // Global company selector (top bar): narrows the company-owned lists; customers/products are shared.
  const company = getSelectedCompany();
  // Returns follow their order's company; 
  [saleOrders, quotations, invoices, creditNotes, salePayments, returns] = [saleOrders, quotations, invoices, creditNotes, salePayments, returns].map(r => filterByCompany(r, company));
  // Plan 2a: a Sales member sees only their own enquiries and the quotations/orders/invoices/payments
  // that belong to them; the Sales Head and PMs see everything.
  if (me) ({ leads, quotations, saleOrders, invoices, creditNotes, salePayments } = scopeSalesLists(me, { leads, quotations, saleOrders, invoices, creditNotes, salePayments }));
  // "Assign to" pool for Tasks/Team — any active head who holds Sales, same filter-after-
  // getFunctionalHeads pattern app/production/page.js already uses for its own assignee dropdown.
  const designations = new Map((await queryAll(
    'SELECT e.user_id, d.name FROM employees e LEFT JOIN designations d ON d.id = e.designation_id WHERE e.user_id IS NOT NULL'
  )).map(r => [r.user_id, r.name]));
  const crmUsers = heads.filter(h => h.active && h.departments.includes('Sales')).map(h => ({ ...h, designation: designations.get(h.id) || null }));
  // Any saved account = a number has been connected (a paused one keeps its inbox history).
  const whatsappConnected = (await queryAll('SELECT 1 FROM whatsapp_accounts LIMIT 1')).length > 0;
  const savedViews = savedViewRows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') }));

  // Lists loaded only so the visibility rule could run are not sent.
  const unsent = k => !sendKeys.includes(k);
  if (unsent('leads')) leads = [];
  if (unsent('quotations')) quotations = [];
  if (unsent('saleOrders')) saleOrders = [];
  if (unsent('invoices')) invoices = [];

  return (
    <SalesWorkspace saleOrders={packRows(saleOrders)} leads={packRows(leads)} customers={customers} quotations={packRows(quotations)} priceLists={priceLists} returns={returns} tradeRequests={tradeRequests} inventoryItems={inventoryItems} invoices={invoices} creditNotes={creditNotes} departments={['Sales']} users={crmUsers} savedViews={savedViews} initialTab={sp?.tab} salePayments={salePayments} branches={branches} salesProducts={salesProducts} salesTargets={salesTargets} stages={stages} isSalesHead={isDepartmentHead(user, 'Sales')} company={company} whatsappConnected={whatsappConnected} loadedKeys={sendKeys} />
  );
}
