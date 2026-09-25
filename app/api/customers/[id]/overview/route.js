// app/api/customers/[id]/overview/route.js — Sales CRM plan 4, Customer 360. Everything about one
// customer in one read: enquiries, Diary, quotations, orders + payments, projects, invoices +
// receipts, service calls/contracts, installed base (with warranty) and competitors. A Sales member
// (plan 2a) sees only their own enquiries / quotations / orders and what hangs off them.
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { scopeSalesLists } from '@/lib/sales-visibility.mjs';
import { warrantyWindow } from '@/lib/installed-base.mjs';
import { todayISO } from '@/lib/date';

const inList = ids => (ids.length ? ids.map(() => '?').join(',') : 'NULL');

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!(isPM(user) || ['Sales', 'Marketing', 'Accounts'].some(d => canAccessDepartment(user, d)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = Number(params.id);
  const customer = await queryOne('SELECT id, name FROM customers WHERE id = ?', [id]);
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const leads = await queryAll(
    `SELECT id, lead_name, company_name, sales_call_status, expected_value, enquiry_date, created_at,
            account_manager, assigned_to, initiated_by, created_by, owner_dept, lost_reason
       FROM leads WHERE converted_customer_id = ? ORDER BY id DESC`, [id]);
  const leadIds = leads.map(l => l.id);
  const [quotations, saleOrders, projects] = await Promise.all([
    queryAll(`SELECT id, quotation_no, quotation_date, status, total, lead_id, created_by, revision_no, approval_status
                FROM quotations WHERE customer_id = ? ORDER BY id DESC`, [id]),
    queryAll(`SELECT so.id, so.so_no, so.order_date, so.status, so.total, so.lead_id, so.quotation_id, so.created_by,
                     so.sales_person_override, so.company,
                     (SELECT COALESCE(SUM(p.amount), 0) FROM sale_order_payments p WHERE p.sale_order_id = so.id) AS received
                FROM sale_orders so
               WHERE so.customer_id = ? OR so.lead_id IN (${inList(leadIds)})
               ORDER BY so.id DESC`, [id, ...leadIds]),
    queryAll(`SELECT id, project_no, name, status, sale_order_id FROM projects WHERE customer_id = ? ORDER BY id DESC`, [id]),
  ]);
  const diaryNotes = await queryAll(
    `SELECT id, lead_id, customer_id, note_type, content, visit_date, next_plan_date, created_by, created_at
       FROM crm_notes WHERE customer_id = ? OR lead_id IN (${inList(leadIds)}) ORDER BY id DESC LIMIT 50`, [id, ...leadIds]);
  const invoices = await queryAll(
    `SELECT si.id, si.invoice_no, si.invoice_date, si.status, si.total, si.sale_order_id, si.quotation_id, si.created_by,
            (SELECT COALESCE(SUM(r.amount), 0) FROM customer_receipts r WHERE r.sales_invoice_id = si.id) AS received
       FROM sales_invoices si WHERE si.customer_id = ? ORDER BY si.id DESC`, [id]);

  const me = salesScope(user);
  const scoped = me ? scopeSalesLists(me, { leads, quotations, saleOrders, invoices, diaryNotes }) : { leads, quotations, saleOrders, invoices, diaryNotes };

  // Projects: a member sees the ones behind their own orders.
  const soIds = new Set(scoped.saleOrders.map(s => s.id));
  const visibleProjects = me ? projects.filter(p => soIds.has(p.sale_order_id)) : projects;
  const projectIds = visibleProjects.map(p => p.id);
  const [serviceCalls, serviceContracts, items, milestones, dispatched, competitors] = await Promise.all([
    queryAll(`SELECT id, call_no, project_id, subject, status, priority, created_at FROM service_calls
               WHERE project_id IN (${inList(projectIds)}) ${me ? '' : 'OR customer_name = ?'} ORDER BY id DESC`, [...projectIds, ...(me ? [] : [customer.name])]),
    queryAll(`SELECT id, contract_no, project_id, start_date, end_date, status, visit_frequency FROM service_contracts
               WHERE project_id IN (${inList(projectIds)}) ${me ? '' : 'OR customer_name = ?'} ORDER BY id DESC`, [...projectIds, ...(me ? [] : [customer.name])]),
    queryAll(`SELECT soi.id, soi.sale_order_id, soi.item_description, soi.qty, soi.uom, soi.warranty_std_days, soi.warranty_accepted_days,
                     soi.from_date_of, soi.installation_required, soi.preventive_maintenance, sp.product_code, sp.serviceable
                FROM sale_order_items soi LEFT JOIN sales_products sp ON sp.id = soi.product_id
               WHERE soi.sale_order_id IN (${inList([...soIds])})`, [...soIds]),
    queryAll(`SELECT project_id, milestone_key, actual_end FROM milestones
               WHERE project_id IN (${inList(projectIds)}) AND milestone_key IN ('packing', 'site_installation', 'commissioning')`, projectIds),
    queryAll(`SELECT project_id, MAX(COALESCE(dispatched_at, updated_at)) AS at FROM packing_lists
               WHERE project_id IN (${inList(projectIds)}) AND status = 'dispatched' GROUP BY project_id`, projectIds),
    queryAll(`SELECT cc.id, cc.lead_id, cc.competitor, cc.product, cc.price, cc.lost_to, cc.notes, cc.created_by, cc.created_at
                FROM customer_competitors cc WHERE cc.customer_id = ? OR cc.lead_id IN (${inList(leadIds)}) ORDER BY cc.id DESC`, [id, ...leadIds]),
  ]);

  // Installed base: each ordered item with its warranty, dated from its project's dispatch /
  // commissioning (installation) when the order has a project.
  const today = todayISO();
  const projectBySo = new Map(visibleProjects.map(p => [p.sale_order_id, p]));
  const dates = new Map();
  for (const p of visibleProjects) dates.set(p.id, { deliveredOn: null, installedOn: null });
  for (const d of dispatched) if (dates.has(d.project_id)) dates.get(d.project_id).deliveredOn = d.at;
  for (const m of milestones) {
    const d = dates.get(m.project_id);
    if (!d || !m.actual_end) continue;
    if (m.milestone_key === 'packing' && !d.deliveredOn) d.deliveredOn = m.actual_end;
    if (m.milestone_key === 'commissioning') d.installedOn = m.actual_end;
    if (m.milestone_key === 'site_installation' && !d.installedOn) d.installedOn = m.actual_end;
  }
  const soById = new Map(scoped.saleOrders.map(s => [s.id, s]));
  const installedBase = items.map(it => {
    const project = projectBySo.get(it.sale_order_id) || null;
    return {
      ...it, so_no: soById.get(it.sale_order_id)?.so_no, project_no: project?.project_no || null,
      warranty: warrantyWindow(it, (project && dates.get(project.id)) || {}, today),
    };
  });
  const leadVisible = new Set(scoped.leads.map(l => l.id));

  return NextResponse.json({
    customer,
    enquiries: scoped.leads,
    diary: scoped.diaryNotes,
    quotations: scoped.quotations,
    orders: scoped.saleOrders,
    invoices: scoped.invoices,
    projects: visibleProjects,
    serviceCalls, serviceContracts, installedBase,
    competitors: me ? competitors.filter(c => (c.lead_id ? leadVisible.has(c.lead_id) : c.created_by === me)) : competitors,
  });
}
