// lib/stock-receipts.js — the receipt-event anchor (design doc Part 17.2/20/22.2). Answers "which
// receipt brought this material into Stores, from which supplier/PO" — a question genuinely
// unanswerable before this: receivePiece() only ever recorded inventory_item_id, and bom_item_id is
// a later CONSUMPTION link (stamped at reservation), not a receipt link, so a piece's actual
// delivery/supplier was lost the moment it left Stores-owned generic stock. This module is a pure
// event header — no material-level data (heat/qty/species) ever belongs here (I5); that lives on
// the receiving entity itself (stock_pieces/inventory_batches/inventory_serials) via receipt_id.
import { execute, queryOne, queryAll, nextNumber } from './db';

// One supplier per receipt, enforced by construction: supplier_id is set once here and this module
// exposes no update path for it — there is no way to retroactively mix suppliers onto one header.
export async function createReceipt({ supplierId, poId, grnRef, gateInwardReceiptId, username } = {}) {
  const inwardBatchNo = await nextNumber('inward_batch', 'INW');
  const { lastId } = await execute(
    `INSERT INTO stock_receipts (inward_batch_no, supplier_id, po_id, grn_ref, gate_inward_receipt_id, received_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [inwardBatchNo, supplierId || null, poId || null, grnRef || null, gateInwardReceiptId || null, username || null]
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
