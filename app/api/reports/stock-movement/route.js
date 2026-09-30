// app/api/reports/stock-movement/route.js — Stock Movement & Project-wise Consumption.
// Opening / added / removed / closing per inventory item for a period, read from stock_movements
// (logged by a DB trigger on inventory_items.on_hand, lib/db.js), plus what each project consumed
// (material_issues + pieces cut for it). History only exists from the first recorded movement, so a
// period that starts earlier is clamped to that date and says so.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { queryAll, queryOne } from '@/lib/db';
import { currentFyBounds } from '@/lib/date';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export async function computeStockMovement(_company, { from, to } = {}) {
  if (!from && !to) ({ from, to } = currentFyBounds());
  const first = await queryOne('SELECT MIN(date(at)) AS d FROM stock_movements');
  const historyStart = first?.d || null;
  let clampedFrom = false;
  if (from && historyStart && from < historyStart) { from = historyStart; clampedFrom = true; }
  const beforeHistory = !!(to && historyStart && to < historyStart);
  const fromD = from || '0000-01-01', toD = to || '9999-12-31';

  const [items, sums, issues, cuts] = await Promise.all([
    queryAll('SELECT id, item_code, description, avg_cost FROM inventory_items ORDER BY description'),
    queryAll(
      `SELECT inventory_item_id AS id,
              SUM(CASE WHEN date(at) < ? OR kind = 'baseline' THEN delta ELSE 0 END) AS opening,
              SUM(CASE WHEN date(at) >= ? AND date(at) <= ? AND delta > 0 AND kind != 'baseline' THEN delta ELSE 0 END) AS added,
              SUM(CASE WHEN date(at) >= ? AND date(at) <= ? AND delta < 0 AND kind != 'baseline' THEN -delta ELSE 0 END) AS removed
         FROM stock_movements GROUP BY inventory_item_id`, [fromD, fromD, toD, fromD, toD]),
    queryAll(
      `SELECT p.project_no, p.customer_name, b.material_description AS material,
              SUM(mi.qty) AS qty, SUM(COALESCE(mi.total_cost, 0)) AS cost
         FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id JOIN projects p ON p.id = b.project_id
        WHERE date(mi.issued_at) >= ? AND date(mi.issued_at) <= ?
        GROUP BY p.id, b.material_description ORDER BY p.project_no, b.material_description`, [fromD, toD]),
    queryAll(
      `SELECT p.project_no, p.customer_name, i.description AS material, COUNT(*) AS pieces, SUM(sp.weight_kg) AS kg
         FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id JOIN projects p ON p.id = sp.project_id
        WHERE sp.status = 'consumed' AND sp.parent_id IS NOT NULL AND sp.cut_at IS NOT NULL
          AND date(sp.cut_at) >= ? AND date(sp.cut_at) <= ?
        GROUP BY p.id, i.id ORDER BY p.project_no, i.description`, [fromD, toD]),
  ]);

  const by = new Map(sums.map(s => [s.id, s]));
  const stockRows = [];
  for (const it of items) {
    const s = by.get(it.id) || {};
    const opening = r2(s.opening), added = r2(s.added), removed = r2(s.removed);
    if (beforeHistory || (!opening && !added && !removed)) continue;
    const closing = r2(opening + added - removed);
    stockRows.push({
      id: it.id, item_code: it.item_code, description: it.description,
      opening, added, removed, closing, value: r2(closing * (it.avg_cost || 0)),
    });
  }
  const consumption = [
    ...issues.map(x => ({ project_no: x.project_no, customer_name: x.customer_name, material: x.material, how: 'Issued', qty: r2(x.qty), cost: r2(x.cost) })),
    ...cuts.map(x => ({ project_no: x.project_no, customer_name: x.customer_name, material: x.material, how: `Cut (${r2(x.kg)} kg)`, qty: x.pieces, cost: null })),
  ].sort((a, b) => String(a.project_no).localeCompare(String(b.project_no)));

  return {
    from, to, historyStart, clampedFrom: clampedFrom || beforeHistory,
    stockRows, consumption,
    totalClosingValue: r2(stockRows.reduce((s, r) => s + r.value, 0)),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await computeStockMovement(null, {
    from: searchParams.get('from') || undefined, to: searchParams.get('to') || undefined }));
}
