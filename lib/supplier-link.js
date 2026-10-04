// The supplier's page (/rfq/<token>) for a purchase order. A PO that came out of an RFQ uses the link the
// supplier already has; a PO bought without one gets its own link to the same page. Either way the page
// shows the PO copy and the delivery form. Links last 180 days and are refreshed whenever one is asked for.
import { randomBytes } from 'node:crypto';
import { queryOne, execute } from './db';

const DAY = 86400000;
const LIFE = 180 * DAY;

// Returns { token } for an issued PO, or { error } (unknown / not issued).
export async function getOrCreateSupplierLink(poId) {
  const po = await queryOne('SELECT id, supplier_id, status FROM purchase_orders WHERE id = ?', [poId]);
  if (!po) return { error: 'Purchase order not found', status: 404 };
  if (po.status !== 'issued') return { error: 'Issue the purchase order first. The supplier link only shows issued orders.', status: 409 };
  const renew = Date.now() + LIFE;

  const rfq = await queryOne(
    `SELECT rs.id, rs.token, rs.token_expires FROM rfq_suppliers rs
       JOIN rfq_items ri ON ri.rfq_id = rs.rfq_id JOIN po_items pi ON pi.bom_item_id = ri.bom_item_id
      WHERE pi.po_id = ? AND rs.supplier_id = ? ORDER BY rs.id DESC LIMIT 1`, [po.id, po.supplier_id]);
  if (rfq) {
    if (rfq.token_expires && rfq.token_expires < renew - 30 * DAY) await execute('UPDATE rfq_suppliers SET token_expires = ? WHERE id = ?', [renew, rfq.id]);
    return { token: rfq.token };
  }
  const own = await queryOne('SELECT id, token, token_expires FROM po_supplier_links WHERE po_id = ?', [po.id]);
  if (own) {
    if (!own.token_expires || own.token_expires < renew - 30 * DAY) await execute('UPDATE po_supplier_links SET token_expires = ? WHERE id = ?', [renew, own.id]);
    return { token: own.token };
  }
  const token = randomBytes(18).toString('hex');
  await execute('INSERT INTO po_supplier_links (po_id, token, token_expires) VALUES (?, ?, ?)', [po.id, token, renew]);
  return { token };
}
