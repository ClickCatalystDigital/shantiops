// Prefill facts for an installation report, keyed to the template's field keys (both forms).
// Everything here is editable in the form afterwards; this only saves re-typing what the system knows.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const s = (v) => (v == null ? '' : String(v));
const join = (...p) => p.filter(Boolean).join(', ');

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('project_id'));
  const p = id && await queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  if (!p) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const master = p.master_project_id || p.id;
  // Split units inherit the master's order/customer when their own link is blank.
  const m = p.master_project_id ? await queryOne('SELECT customer_id, sale_order_id FROM projects WHERE id = ?', [master]) : null;
  const customerId = p.customer_id || m?.customer_id;
  const saleOrderId = p.sale_order_id || m?.sale_order_id;
  const cust = customerId ? await queryOne('SELECT * FROM customers WHERE id = ?', [customerId]) : null;
  const order = saleOrderId ? await queryOne('SELECT * FROM sale_orders WHERE id = ?', [saleOrderId]) : null;
  const contact = cust && await queryOne('SELECT * FROM contacts WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, id LIMIT 1', [cust.id]);
  // Site address: the order's own ship-to when set, else the customer's shipping address, else the customer's main address.
  let address = '';
  if (order?.address_type === 'Other' && order.order_address) address = order.order_address;
  else if (cust) {
    const ship = await queryOne("SELECT * FROM addresses WHERE customer_id = ? AND active = 1 AND address_type = 'Shipping' ORDER BY is_primary DESC, id LIMIT 1", [cust.id]);
    address = ship ? join(ship.line1, ship.line2, ship.line3, ship.city, ship.state, ship.pin_code)
      : join(cust.address, cust.address2, cust.address3, cust.city, cust.state, cust.pin_code);
  }
  // QC's statutory header (form II/III boiler details): maker's no, boiler type, year. Child docs live on the child project.
  const qc = await queryOne('SELECT * FROM qc_documents WHERE project_id IN (?, ?) ORDER BY (project_id = ?) DESC, id DESC LIMIT 1', [p.id, master, p.id]);
  const name = cust?.name || p.customer_name || '';
  const phone = order?.contact_mobile || contact?.phone || cust?.phone || '';
  const person = order?.contact_person || contact?.name || '';
  const email = contact?.email || cust?.email || '';
  // Working pressure = the model pressure entered when the project was created; design = 1.5 x working.
  const working = p.model_pressure != null ? Number(p.model_pressure) : (qc?.working_pressure != null ? Number(qc.working_pressure) : null);
  const design = working != null ? String(Math.round(working * 1.5 * 100) / 100) : s(qc?.design_pressure);
  const model = [p.series, p.model_design].filter(Boolean).join(' ');
  const capacity = s(p.model_capacity);
  const serial = s(qc?.makers_no);
  return NextResponse.json({
    // Commissioning keys
    customer_name: name, site_address: address, contact_person: person, contact_no: phone,
    equipment_type: s(qc?.boiler_type), model, capacity, year_of_make: s(qc?.year_of_make), serial_no: serial,
    design_pressure: design, working_pressure: working != null ? String(working) : '',
    // Field service report keys
    client: name, address, phone, email, person_contacted: person,
    unit_sno: serial || p.project_no, make: p.company || 'Shanti Boilers',
  });
}
