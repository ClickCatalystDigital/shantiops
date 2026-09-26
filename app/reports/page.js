// app/reports/page.js — the "Reports" main tab (REPORT-ENGINE-PLAN Phase 3), same gating shape as
// app/accounts/page.js / app/installation/page.js. Catalog-driven: only departments with >=1 entry
// in lib/reports/catalog.js get here at all (components/Nav.jsx only links to it for those
// departments); a direct hit on a department with no reports redirects home same as no access.
//
// No ?dept= query, for admin/manager only: the consolidated "All Reports" view (2026-08-22) —
// every department's reports plus the Management reports, one sidebar with groups, instead of the
// wall of identically-labeled per-department "Reports" tabs Nav.jsx used to build for this
// audience. Single-department heads and the pure 'executive' role never hit this branch: a head's
// own Nav tab always carries ?dept=, and 'executive' keeps its own /executive/reports tab (it has
// no department access to consolidate).
import { queryAll } from '@/lib/db';
import { getSelectedCompany } from '@/lib/company-filter-server';
import { filterByCompany } from '@/lib/company-filter.mjs';
import { salesScope } from '@/lib/sales-visibility';
import { scopeSalesLists } from '@/lib/sales-visibility.mjs';
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, headDepartments, roleHome } from '@/lib/auth';
import {
  getCompanySettings, getLeads, getOpportunities, getCampaigns, getSalesStages, getCrmTasks, getLeadNotes, getFunctionalHeads,
  getBranches, getSalesTargets, getDiaryNotes, getExpenseClaims, getQuotations, getSaleOrders, getSalesProducts, getSalePayments,
} from '@/lib/data';
import { reportsForDepartment, REPORT_DEPARTMENTS } from '@/lib/reports/catalog';
import ReportsWorkspace from '@/components/ReportsWorkspace';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

// Same data the standalone /crm-reports page fetches (app/crm-reports/page.js) — the 6 CRM
// analytics catalog entries (lib/reports/catalog.js, §5an) need it, fetched only when a Sales or
// Marketing report could actually be in view, not on every unrelated department's Reports tab.
// Sales CRM expansion Phase 5 widened this with branches/targets/diary notes/expense claims/
// quotations — the 13 new Sales Call reports' own shared data, same "one fetch, many reports" idiom.
//
// `includeSales` (2026-09-23 isolation fix): quotations/saleOrders are Sales-exclusive data
// (pricing, deal values) — confirmed none of Marketing's 3 report cards (lead_funnel,
// leads_by_source, campaign_performance in components/CrmReportPanels.jsx) read either field.
// Every other field here stays unconditional — branches/products are genuinely shared masters,
// diary is shared owner_dept-gated activity data, expenseClaims/salesTargets aren't part of this fix.
async function getCrmData(includeSales, user, customerId = null) {
  const [leads, opportunities, campaigns, stages, tasks, notes, heads, branches, salesTargets, diaryNotes, expenseClaims, quotations, saleOrders, salesProducts] = await Promise.all([
    getLeads(), getOpportunities(), getCampaigns(), getSalesStages(), getCrmTasks(), getLeadNotes(), getFunctionalHeads(),
    getBranches(), getSalesTargets(), getDiaryNotes(), getExpenseClaims(),
    includeSales ? getQuotations() : [], includeSales ? getSaleOrders() : [], getSalesProducts(),
  ]);
  // Order Book & Collections — the payment log (Sales-only data, like quotations/orders).
  const salePayments = includeSales ? await getSalePayments() : [];
  // Plan 3c — stage history for Employee 360's days-per-stage (small table; scoped below with leads).
  const stageHistory = includeSales ? await queryAll('SELECT id, lead_id, from_stage, to_stage, changed_by, changed_at FROM lead_stage_history') : [];
  const competitors = includeSales ? await queryAll(
    `SELECT cc.*, c.name AS customer_name, l.company_name AS lead_name FROM customer_competitors cc
       LEFT JOIN customers c ON c.id = cc.customer_id LEFT JOIN leads l ON l.id = cc.lead_id ORDER BY cc.id DESC`) : [];
  const users = heads.filter(h => h.active && h.departments.some(d => CRM_DEPARTMENTS.includes(d)));
  // Global company selector: the Sales report cards read quotations/orders; filter them here.
  const company = getSelectedCompany();
  const base = { leads, quotations: filterByCompany(quotations, company), saleOrders: filterByCompany(saleOrders, company), diaryNotes,
    salePayments: filterByCompany(salePayments, company) };
  // Plan 2a: a Sales member's reports cover only their own records.
  const me = salesScope(user);
  const scoped = me ? scopeSalesLists(me, base) : base;
  // Plan 4 — "Open in Reports" from Customer 360 (?customer=<id>) narrows every Sales report to one customer.
  if (customerId) {
    const cid = Number(customerId);
    scoped.leads = scoped.leads.filter(l => Number(l.converted_customer_id) === cid);
    const ids = new Set(scoped.leads.map(l => l.id));
    scoped.quotations = scoped.quotations.filter(q => Number(q.customer_id) === cid || ids.has(q.lead_id));
    scoped.saleOrders = scoped.saleOrders.filter(so => Number(so.customer_id) === cid || ids.has(so.lead_id));
    scoped.diaryNotes = scoped.diaryNotes.filter(n => Number(n.customer_id) === cid || ids.has(n.lead_id));
  }
  const visibleOrderIds = new Set(scoped.saleOrders.map(so => Number(so.id)));
  const visibleLeadIds = new Set(scoped.leads.map(l => l.id));
  return { opportunities, campaigns, stages, tasks, notes, users, branches, salesTargets, expenseClaims, salesProducts,
    stageHistory: stageHistory.filter(h => visibleLeadIds.has(h.lead_id)),
    competitors: competitors.filter(c => (c.lead_id ? visibleLeadIds.has(c.lead_id) : (!me || c.created_by === me) && (!customerId || Number(c.customer_id) === Number(customerId)))),
    leads: scoped.leads, quotations: scoped.quotations, saleOrders: scoped.saleOrders, diaryNotes: scoped.diaryNotes,
    salePayments: (scoped.salePayments || []).filter(p => visibleOrderIds.has(Number(p.sale_order_id))) };
}

export const dynamic = 'force-dynamic';

async function customerName(id) {
  const rows = await queryAll('SELECT name FROM customers WHERE id = ?', [Number(id)]);
  return rows[0]?.name || `Customer #${id}`;
}

// Same admin/manager definition Nav.jsx's isDeptPM uses — kept in sync by comment, not import,
// since Nav.jsx is a client component and this file needs its own server-side check.
function isDeptPM(user) {
  return !!user && ['admin', 'manager'].includes(user.role);
}

const MANAGEMENT_REPORTS = [
  { key: 'management-report', title: 'Management Report' },
  { key: 'project-profitability', title: 'Project Profitability' },
  { key: 'customer-profitability', title: 'Customer Profitability' },
  { key: 'procurement-spend', title: 'Procurement Spend' },
  { key: 'manufacturing-performance', title: 'Manufacturing Performance' },
].map((r) => ({ ...r, hasOwnControls: true }));

export default async function ReportsPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const sp = await searchParams;
  const department = sp?.dept;
  // With a company picked in the top bar, a report's own company buttons offer only that one.
  const allCompanies = await getCompanySettings();
  const picked = getSelectedCompany();
  const companies = picked ? allCompanies.filter(c => c.company === picked) : allCompanies;

  if (!department) {
    // Generalized (2026-08-23, plan §3) beyond admin/manager: a non-PM head granted 2+ departments
    // that each have catalog reports also lands here, scoped to just their own departments — the
    // alternative (Nav.jsx building one "Reports" tab per department) produced N identically-labeled
    // tabs. isDeptPM still gets every department; everyone else gets the intersection with their own
    // grants, and redirects home only if that intersection is empty.
    const isPmView = isDeptPM(user);
    const myReportDepts = isPmView ? REPORT_DEPARTMENTS : REPORT_DEPARTMENTS.filter(d => headDepartments(user).includes(d));
    if (myReportDepts.length === 0) redirect(roleHome(user));
    const groups = [
      // Management first — the group a PM/admin actually opens most on this consolidated view,
      // not buried after 8 other departments' worth of scrolling. PM-only, never shown to a head.
      ...(isPmView ? [{ department: 'Management', reports: MANAGEMENT_REPORTS }] : []),
      ...myReportDepts.map((dept) => ({
        department: dept,
        reports: reportsForDepartment(dept).map((r) => ({
          key: r.key, title: r.title,
          needsCompany: r.needsCompany !== false,
          hasOwnPdfControl: !!r.hasOwnPdfControl,
          hasOwnControls: !!r.hasOwnControls,
        })),
      })),
    ];
    // Only fetch CRM data when Sales/Marketing is actually in view — same guard the
    // single-department branch below already uses, not assumed just because this is the
    // multi-department branch.
    const crmData = myReportDepts.some(d => CRM_DEPARTMENTS.includes(d)) ? await getCrmData(myReportDepts.includes('Sales'), user, sp?.customer) : undefined;
    // Title reflects what's actually shown — "All Reports" only when it truly is all of them.
    const title = isPmView ? 'All Reports' : `${myReportDepts.join(' & ')} Reports`;
    return (
      <main className="min-h-[calc(100svh-3.5rem)]">
        <ReportsWorkspace groups={groups} companies={companies} crmData={crmData} title={title} initialReport={sp?.report} customerFilter={sp?.customer ? await customerName(sp.customer) : null} />
      </main>
    );
  }

  if (!canAccessDepartment(user, department)) redirect(roleHome(user));

  const reports = reportsForDepartment(department).map((r) => ({
    key: r.key, title: r.title,
    needsCompany: r.needsCompany !== false,
    hasOwnPdfControl: !!r.hasOwnPdfControl,
    hasOwnControls: !!r.hasOwnControls,
  }));
  if (!reports.length) redirect(roleHome(user));

  const crmData = CRM_DEPARTMENTS.includes(department) ? await getCrmData(department === 'Sales', user, sp?.customer) : undefined;

  return (
    <main className="min-h-[calc(100svh-3.5rem)]">
      <ReportsWorkspace department={department} reports={reports} companies={companies} crmData={crmData} initialReport={sp?.report} customerFilter={sp?.customer ? await customerName(sp.customer) : null} />
    </main>
  );
}
