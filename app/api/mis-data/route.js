// app/api/mis-data/route.js — extra data for three Sales MIS reports that the Reports page doesn't preload
// (SYSTEM.md §5dr): ?what=prices (Selling vs Cost Price), customers (New Customer Added), usage (Employee Usage).
// prices and usage are Sales Head / PM only — cost prices and login times aren't for every Sales member.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isDepartmentHead } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const what = sp.get('what');
  const head = isDepartmentHead(user, 'Sales');

  if (what === 'prices') {
    if (!head) return NextResponse.json({ error: 'Only the Sales Head can see cost prices' }, { status: 403 });
    // List price + cost per product, with the average rate actually quoted and actually sold (cancelled orders left out).
    const rows = await queryAll(`
      SELECT p.id, p.product_code, p.product_name, p.price, p.cost_price,
        (SELECT AVG(qi.rate) FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE qi.product_id = p.id AND q.status != 'draft') AS quoted_rate,
        (SELECT COUNT(*) FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE qi.product_id = p.id AND q.status != 'draft') AS quoted_lines,
        (SELECT SUM(si.qty * si.rate * (1 - COALESCE(si.discount_pct,0)/100.0)) / NULLIF(SUM(si.qty),0) FROM sale_order_items si JOIN sale_orders so ON so.id = si.sale_order_id WHERE si.product_id = p.id AND COALESCE(so.status,'') != 'cancelled') AS sold_rate,
        (SELECT SUM(si.qty) FROM sale_order_items si JOIN sale_orders so ON so.id = si.sale_order_id WHERE si.product_id = p.id AND COALESCE(so.status,'') != 'cancelled') AS sold_qty
      FROM sales_products p WHERE p.active = 1
      ORDER BY (sold_qty IS NULL), sold_qty DESC, p.product_name LIMIT 1500`);
    return NextResponse.json(rows);
  }

  if (what === 'customers') {
    // Customers added through the app. The 2026-09-25 old-CRM bulk load (legacy_crm_json set) is left out so it doesn't swamp the list.
    const from = sp.get('from') || '0000-01-01', to = sp.get('to') || '9999-12-31';
    const rows = await queryAll(`
      SELECT id, name, party_code, city AS district, state, phone, email, account_manager, source, created_at
        FROM customers WHERE legacy_crm_json IS NULL AND date(created_at) >= ? AND date(created_at) <= ?
       ORDER BY created_at DESC LIMIT 1000`, [from, to]);
    return NextResponse.json(rows);
  }

  if (what === 'usage') {
    if (!head) return NextResponse.json({ error: 'Only the Sales Head can see usage' }, { status: 403 });
    const rows = await queryAll(`
      SELECT u.username, u.display_name, u.active, u.last_login,
        (SELECT MAX(created_at) FROM crm_notes WHERE created_by = u.username) AS last_diary,
        (SELECT COUNT(*) FROM crm_notes WHERE created_by = u.username AND created_at >= date('now','-30 day')) AS diary_30d,
        (SELECT COUNT(*) FROM leads WHERE created_by = u.username AND created_at >= date('now','-30 day')) AS leads_30d,
        (SELECT COUNT(*) FROM lead_stage_history WHERE changed_by = u.username AND changed_at >= date('now','-30 day')) AS stage_changes_30d
      FROM users u WHERE u.role != 'customer' AND (',' || COALESCE(u.departments,'') || ',' LIKE '%,Sales,%' OR ',' || COALESCE(u.departments,'') || ',' LIKE '%,Marketing,%')
      ORDER BY u.active DESC, u.last_login DESC`);
    return NextResponse.json(rows);
  }
  if (what === 'amc') {
    if (!head) return NextResponse.json({ error: 'Only the Sales Head can see AMC profitability' }, { status: 403 });
    const rows = await queryAll(`
      SELECT c.id, c.contract_no, c.customer_name, c.status, c.start_date, c.end_date, c.contract_value, c.received_value,
        (SELECT COALESCE(SUM(amount),0) FROM service_contract_costs WHERE contract_id = c.id) AS cost
      FROM service_contracts c ORDER BY c.end_date DESC LIMIT 500`);
    return NextResponse.json(rows);
  }
  return NextResponse.json({ error: 'Unknown report data' }, { status: 400 });
}
