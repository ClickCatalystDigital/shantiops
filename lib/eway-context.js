// lib/eway-context.js — loads everything the e-way bill checklist and generation need for one packing
// list in one place, so GET (checklist) and POST (generate) read the very same facts.
import { queryOne, queryAll } from '@/lib/db';
import { isNicConfigured } from '@/lib/eway-bill';
import { ewayReadiness } from '@/lib/eway-readiness.mjs';

export async function loadEwayContext(listId) {
  const list = await queryOne(
    `SELECT pl.id, pl.packing_no, pl.status, pl.project_id, pl.eway_bill_no, pl.transport_distance_km, pl.transport_mode,
            pl.vehicle_type, pl.vehicle_no, pl.dispatch_through, pl.sales_invoice_id,
            COALESCE(pl.company, p.company) AS company, p.customer_id
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`, [listId]);
  if (!list) return null;
  const [customer, company, invoice, invoiceItems, cred] = await Promise.all([
    list.customer_id ? queryOne('SELECT name, gst_no, state_code, pin_code, address, address2, city FROM customers WHERE id = ?', [list.customer_id]) : null,
    list.company ? queryOne('SELECT legal_name, gstin, state_code, registered_address, place, pincode FROM company_settings WHERE company = ?', [list.company]) : null,
    list.sales_invoice_id ? queryOne('SELECT invoice_no, invoice_date, subtotal, cgst_amount, sgst_amount, igst_amount, total, status FROM sales_invoices WHERE id = ?', [list.sales_invoice_id]) : null,
    list.sales_invoice_id ? queryAll('SELECT item_description, hsn_code, qty, uom, amount, gst_rate_pct FROM sales_invoice_items WHERE sales_invoice_id = ?', [list.sales_invoice_id]) : [],
    list.company ? queryOne('SELECT 1 AS x FROM eway_bill_credentials WHERE company = ?', [list.company]) : null,
  ]);
  const checks = ewayReadiness({ list, customer, company, invoice, invoiceItems, hasCredentials: !!cred, nicConfigured: isNicConfigured() });
  return { list, customer, company, invoice, invoiceItems, checks };
}
