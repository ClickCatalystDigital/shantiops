// lib/sales-visibility.js — server side of Sales CRM plan 2a (predicates in sales-visibility.mjs).
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { isPM, canAccessDepartment, isDepartmentHead } from '@/lib/auth';
import { leadVisible, quotationVisible, saleOrderVisible } from '@/lib/sales-visibility.mjs';

// The username to scope to, or null when this user sees every Sales record (PM, Sales Head, or
// someone who reaches these records through another department, e.g. Accounts/Design).
export function salesScope(user) {
  if (!user || isPM(user) || isDepartmentHead(user, 'Sales')) return null;
  return canAccessDepartment(user, 'Sales') ? user.username : null;
}

async function visibleLeadIdSet(me) {
  const rows = await queryAll(`SELECT id, owner_dept, account_manager, assigned_to, initiated_by, created_by FROM leads
    WHERE ? IN (account_manager, assigned_to, initiated_by, created_by)`, [me]);
  return new Set(rows.filter(l => leadVisible(l, me)).map(l => Number(l.id)));
}

// For [id] routes: returns a 404 response when the record exists but isn't this member's, else null.
export async function hiddenSalesRecord(user, kind, id) {
  const me = salesScope(user);
  if (!me || !id) return null;
  let ok = true;
  if (kind === 'lead') {
    const l = await queryOne('SELECT owner_dept, account_manager, assigned_to, initiated_by, created_by FROM leads WHERE id = ?', [id]);
    ok = !l || leadVisible(l, me);
  } else if (kind === 'quotation') {
    const q = await queryOne('SELECT created_by, lead_id FROM quotations WHERE id = ?', [id]);
    ok = !q || quotationVisible(q, me, await visibleLeadIdSet(me));
  } else if (kind === 'sale_order') {
    const so = await queryOne('SELECT created_by, lead_id, sales_person_override FROM sale_orders WHERE id = ?', [id]);
    ok = !so || saleOrderVisible(so, me, await visibleLeadIdSet(me));
  } else if (kind === 'payment') {
    const p = await queryOne('SELECT sale_order_id FROM sale_order_payments WHERE id = ?', [id]);
    return p ? hiddenSalesRecord(user, 'sale_order', p.sale_order_id) : null;
  }
  return ok ? null : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// For list routes: keep only this member's rows (kind: 'leads' | 'quotations' | 'saleOrders').
export async function scopeRows(user, kind, rows) {
  const me = salesScope(user);
  if (!me) return rows;
  if (kind === 'leads') return rows.filter(l => leadVisible(l, me));
  const ids = await visibleLeadIdSet(me);
  return rows.filter(r => (kind === 'quotations' ? quotationVisible : saleOrderVisible)(r, me, ids));
}
