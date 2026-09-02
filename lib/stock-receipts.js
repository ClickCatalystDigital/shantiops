// lib/stock-receipts.js — the receipt-event anchor (design doc Part 17.2/20/22.2). Answers "which
// receipt brought this material into Stores, from which supplier/PO" — a question genuinely
// unanswerable before this: receivePiece() only ever recorded inventory_item_id, and bom_item_id is
// a later CONSUMPTION link (stamped at reservation), not a receipt link, so a piece's actual
// delivery/supplier was lost the moment it left Stores-owned generic stock. This module is a pure
// event header — no material-level data (heat/qty/species) ever belongs here (I5); that lives on
// the receiving entity itself (stock_pieces/inventory_batches/inventory_serials) via receipt_id.
import { execute, queryOne, queryAll, nextNumber } from './db';

// Which legal entity this receipt's tag should print under (gap found in review — stock_receipts
// itself has no company column, deliberately, per this module's own "no material-level data" rule).
// Prefers the linked PO's own company (real, already backfilled per ACCOUNTING-IMPLEMENTATION-PLAN.md
// Phase 0); falls back to whichever project the receipt's own bom_items lines belong to — the common
// case (a receipt usually serves one project's BOM lines) — rather than silently defaulting to
// Shanti Boilers regardless of the real entity.
export async function getReceiptCompany(receiptId) {
  const row = await queryOne(
    `SELECT COALESCE(po.company, p.company) AS company
       FROM stock_receipts r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       LEFT JOIN bom_items b ON b.receipt_id = r.id
       LEFT JOIN projects p ON p.id = b.project_id
      WHERE r.id = ? AND COALESCE(po.company, p.company) IS NOT NULL
      LIMIT 1`,
    [receiptId]
  );
  return row?.company || null;
}

// One supplier per receipt, enforced by construction: supplier_id is set once here and this module
// exposes no update path for it — there is no way to retroactively mix suppliers onto one header.
export async function createReceipt({ supplierId, poId, grnRef, invoiceNo, gateInwardReceiptId, username } = {}) {
  const inwardBatchNo = await nextNumber('inward_batch', 'INW');
  const { lastId } = await execute(
    `INSERT INTO stock_receipts (inward_batch_no, supplier_id, po_id, grn_ref, invoice_no, gate_inward_receipt_id, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inwardBatchNo, supplierId || null, poId || null, grnRef || null, invoiceNo || null, gateInwardReceiptId || null, username || null]
  );
  return { id: Number(lastId), inward_batch_no: inwardBatchNo };
}

export async function getReceipt(id) {
  return queryOne(
    `SELECT r.*, s.name AS supplier_name, po.po_no
       FROM stock_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON po.id = r.po_id
      WHERE r.id = ?`,
    [id]
  );
}

// Recent receipts for ReceiptPicker.jsx's "pick an existing one" list (gap-closure round,
// 2026-08-26) — a delivery is often received across several calls (multiple pieces/batches/serials
// against one physical truckload), so the picker needs to offer "reuse today's receipt" rather than
// forcing a brand-new header every single time.
export async function listRecentReceipts(limit = 20) {
  return queryAll(
    `SELECT r.*, s.name AS supplier_name, po.po_no
       FROM stock_receipts r
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON po.id = r.po_id
      ORDER BY r.id DESC LIMIT ?`,
    [limit]
  );
}

// Every bom_items / stock_pieces / inventory_batches / inventory_serials row that came in on this
// receipt (Feature A, canonical Stores Receiving) — three separate small queries rather than one
// UNION, since the three tables share no common column shape. Feeds the identification tag PDF,
// which lists every real line rather than guessing a single "dominant" quantity.
export async function getReceiptLines(receiptId) {
  const [bomItems, pieces, batches, serials] = await Promise.all([
    queryAll(
      `SELECT id, material_description AS description, grn_qty_text AS qty FROM bom_items WHERE receipt_id = ?`,
      [receiptId]),
    queryAll(
      `SELECT id, code AS description, weight_kg AS qty FROM stock_pieces WHERE receipt_id = ?`,
      [receiptId]),
    queryAll(
      `SELECT ib.id, ii.description AS description, ib.qty AS qty
         FROM inventory_batches ib JOIN inventory_items ii ON ii.id = ib.inventory_item_id
        WHERE ib.receipt_id = ?`, [receiptId]),
    queryAll(
      `SELECT ise.id, ise.code AS description, 1 AS qty
         FROM inventory_serials ise WHERE ise.receipt_id = ?`, [receiptId]),
  ]);
  // `kind` disambiguates ids across the four source tables, which are otherwise independent
  // sequences (a bom_item #5 and a stock_piece #5 are unrelated rows) — a caller filtering to one
  // specific bom_item must not accidentally match a piece/batch/serial row sharing that same number.
  return [
    ...bomItems.map(r => ({ ...r, kind: 'bom_item' })),
    ...pieces.map(r => ({ ...r, kind: 'stock_piece' })),
    ...batches.map(r => ({ ...r, kind: 'inventory_batch' })),
    ...serials.map(r => ({ ...r, kind: 'inventory_serial' })),
  ];
}
