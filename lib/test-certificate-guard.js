// lib/test-certificate-guard.js — every table with a real, enforced reference into
// test_certificates(id) that would block a `DELETE FROM test_certificates` if not checked first.
//
// Same bug class this repo already centralized once for bom_items (lib/bom-item-guard.js) — Turso
// enforces foreign keys on this connection, and app/api/test-certificates/[id]/route.js's DELETE
// handler only ever hand-checked one of them (qc_document_parts). Found live: 9 other tables
// (bom_items, qc_mountings, stock_pieces, job_cards, inventory_batches, inventory_serials,
// bom_item_receipts, bom_item_child_certificates, plus the already-checked qc_document_parts)
// carry a real NO ACTION FK — deleting a certificate referenced by any of the unguarded ones threw
// a raw SQLITE_CONSTRAINT error instead of a clean message.
//
// The list was generated from the real schema, not hand-counted from source:
//   SELECT name FROM sqlite_master WHERE type='table' ...
//   then PRAGMA foreign_key_list(<table>) filtered to fk.table === 'test_certificates'
// certificate_projects is deliberately excluded — it's the one CASCADE case, but unlike
// bom-item-guard.js's supplier_quotes precedent, it's a pure many-to-many association (which
// projects use this cert) with no business data of its own worth protecting, so letting it
// cascade away with the certificate is correct, not a gap.
import { queryAll } from './db';

export const TEST_CERTIFICATE_BLOCKING_TABLES = [
  { table: 'qc_document_parts', column: 'test_certificate_id', label: 'is linked to a statutory QC document' },
  { table: 'bom_items', column: 'test_certificate_id', label: 'is linked to a BOM item' },
  { table: 'qc_mountings', column: 'test_certificate_id', label: 'is linked to a Mounting & Fittings row' },
  { table: 'stock_pieces', column: 'test_certificate_id', label: 'is linked to a stock piece' },
  { table: 'job_cards', column: 'test_certificate_id', label: 'is linked to a job card' },
  { table: 'inventory_batches', column: 'test_certificate_id', label: 'is linked to an inventory batch' },
  { table: 'inventory_serials', column: 'test_certificate_id', label: 'is linked to a serial-tracked item' },
  { table: 'bom_item_receipts', column: 'test_certificate_id', label: 'is linked to a receipt' },
  { table: 'bom_item_child_certificates', column: 'certificate_id', label: 'is assigned to a split-unit allocation' },
];

// One certificate id -> { blocked, reasons: [{table, label}] } — a single, human-readable reason
// for the DELETE route's own 409 message.
export async function findBlockingReferences(certificateId) {
  const reasons = [];
  for (const { table, column, label } of TEST_CERTIFICATE_BLOCKING_TABLES) {
    const rows = await queryAll(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`, [certificateId]);
    if (rows.length > 0) reasons.push({ table, label });
  }
  return { blocked: reasons.length > 0, reasons };
}
