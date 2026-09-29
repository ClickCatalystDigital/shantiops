// lib/order-spec-server.js — DB side of the New Project defaults (rules: lib/order-spec.mjs).
// getOrderSpecDefaults: read-only, side-effect free. recordProjectSpec: best-effort learning, called after a
// project made from an order is saved; it never throws into the caller.
import { queryAll, queryOne, execute } from './db';
import { mainLine, orderSpecDefaults, SPEC_FIELDS } from './order-spec.mjs';
import { isValidSeries } from './qc-series';

async function orderLines(orderId) {
  return queryAll(
    `SELECT i.product_id, i.item_description, i.qty, i.rate, i.amount, sp.product_name, sp.product_type
       FROM sale_order_items i LEFT JOIN sales_products sp ON sp.id = i.product_id
      WHERE i.sale_order_id = ? ORDER BY i.sort_order, i.id`, [orderId]);
}

// what saved projects taught, for one product: { field: [{ value, uses }] } (values as numbers for capacity/pressure)
async function memoryFor(productId) {
  const rows = await queryAll(
    `SELECT m.field, m.value, COUNT(*) AS uses FROM project_spec_memory m JOIN projects p ON p.id = m.project_id
      WHERE m.product_id = ? GROUP BY m.field, m.value`, [productId]);
  const out = {};
  for (const r of rows) (out[r.field] ||= []).push({ value: r.field === 'model_capacity' || r.field === 'model_pressure' ? Number(r.value) : r.value, uses: Number(r.uses) });
  return out;
}

export async function getOrderSpecDefaults(orderId) {
  const lines = await orderLines(orderId);
  const main = mainLine(lines);
  const memory = main?.line.product_id ? await memoryFor(main.line.product_id) : {};
  return orderSpecDefaults(lines, memory);
}

// Record the values now stored on the project against the order's main product. One row per project per field.
export async function recordProjectSpec(projectId) {
  try {
    const p = await queryOne('SELECT id, sale_order_id, series, model_design, model_capacity, model_pressure FROM projects WHERE id = ?', [projectId]);
    if (!p?.sale_order_id) return;
    const main = mainLine(await orderLines(p.sale_order_id));
    const productId = main?.line.product_id;
    if (!productId) return;
    for (const f of SPEC_FIELDS) {
      const v = p[f];
      const ok = f === 'series' ? isValidSeries(v) : f === 'model_design' ? !!v : Number(v) > 0;
      if (!ok) { await execute('DELETE FROM project_spec_memory WHERE project_id = ? AND field = ?', [p.id, f]); continue; }
      await execute(
        `INSERT INTO project_spec_memory (project_id, product_id, field, value) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, field) DO UPDATE SET product_id = excluded.product_id, value = excluded.value, saved_at = CURRENT_TIMESTAMP`,
        [p.id, productId, f, String(v)]);
    }
  } catch (err) { console.error('recordProjectSpec', err); }
}
