// lib/stock-pieces.js — Cutting & Remnant Management, the cut/lineage half. A piece-tracked
// inventory_items row (track_pieces=1) holds a list of stock_pieces instead of a hand-edited
// on_hand number; on_hand becomes a rollup (count of 'available' pieces) so the existing Stores
// Inventory table keeps working unmodified. See lib/remnant-match.js for the other half (matching
// a BOM line's required dimensions against this stock automatically at BOM release).
import { execute, queryOne, queryAll, withTransaction } from './db';
import { isOpenStatus } from './bom-fields.mjs';
import { pieceWeight, DEFAULT_DENSITY } from './piece-weight.js';
import { assertTrackingMode } from './tracking-mode';

export { pieceWeight };

function round2(n) { return Math.round(n * 100) / 100; }

async function rollUpOnHand(inventoryItemId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available'",
    [inventoryItemId]
  );
  await execute('UPDATE inventory_items SET on_hand = ? WHERE id = ?', [row?.n || 0, inventoryItemId]);
}

// PL-0007 / LN-0007 — the traceability id the source discussion asked for. Generated from the
// row's own id after insert (simplest unique, sequential, human-readable code available without a
// separate counter table).
function rootCode(kind, id) {
  return `${kind === 'plate' ? 'PL' : 'LN'}-${String(id).padStart(4, '0')}`;
}

// Stores receives new dimensional stock (a bought plate/section, not a remnant). heat_no/
// test_certificate_id captured once here, inherited by every cut child in cutPiece() below — the
// entire heat/lot traceability chain, no re-entry needed at cut time.
//
// bomItemId (Phase 1, optional) — when Stores is receiving specifically against a known open BOM
// requirement (the common PR/PO-driven receiving case), this gates the receipt on that line's
// requires_heat_no/requires_mtc flags. Deliberately PRESENCE validation only, not certified-material
// integrity: requires_heat_no just needs a non-empty string, requires_mtc needs an existing
// test_certificates row (the pre-existing check just below already proves the FK is real) — neither
// checks that the cert's own chemistry/heat actually matches this piece. That stronger check is an
// explicitly deferred, separate QC concern (see the design doc), not silently assumed here.
// requires_supplier_batch/requires_serial_no are enforced by their own receive functions
// (lib/inventory-batches.js / lib/inventory-serials.js, Phase 2), not here — stock_pieces has no
// supplier-batch column, and serial-tracked equipment isn't piece-tracked stock at all.
// No bomItemId given (most receiving — a piece can be received speculatively and later satisfy any
// matching future requirement) means nothing to gate here; that piece's fitness for a specific
// flagged line is instead surfaced as an advisory check at reservation time, never a hard block on
// stock that already physically exists (the approved "warn, don't block" retroactive-stock rule).
//
// receiptId (Phase 2, optional) — the provenance link (I4): which stock_receipts event this piece
// arrived on, so "which supplier/PO/inward batch brought this in" is answerable later. Strictly
// separate from bom_item_id/project_id (stamped later, at reservation/consumption, I4's own
// distinction) — a piece's receipt never changes once set.
export async function receivePiece({ inventoryItemId, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, heat_no, test_certificate_id, bomItemId, receiptId, username }) {
  const invItem = await queryOne('SELECT * FROM inventory_items WHERE id = ?', [inventoryItemId]);
  if (!invItem) throw new Error('Inventory item not found');
  await assertTrackingMode(inventoryItemId, 'piece');
  if (test_certificate_id) {
    const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [test_certificate_id]);
    if (!cert) throw new Error('Test certificate not found');
  }
  if (bomItemId) {
    const bomItem = await queryOne('SELECT requires_heat_no, requires_mtc FROM bom_items WHERE id = ?', [bomItemId]);
    if (bomItem?.requires_heat_no && !String(heat_no || '').trim()) {
      throw new Error('This requirement needs a heat number before it can be received');
    }
    if (bomItem?.requires_mtc && !test_certificate_id) {
      throw new Error('This requirement needs an MTC/certificate before it can be received');
    }
  }
  const weight = pieceWeight({ kind, length_mm, width_mm, thickness_mm, density, kg_per_m });
  if (!(weight > 0)) throw new Error('Enter valid dimensions');

  const { lastId } = await execute(
    `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, weight_kg, status, source, heat_no, test_certificate_id, receipt_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', 'purchase', ?, ?, ?)`,
    [inventoryItemId, kind, length_mm || null, width_mm || null, thickness_mm || null,
      kind === 'plate' ? (Number(density) || DEFAULT_DENSITY) : null, kind === 'linear' ? Number(kg_per_m) : null,
      round2(weight), heat_no || null, test_certificate_id || null, receiptId || null]
  );
  const id = Number(lastId);
  const code = rootCode(kind, id);
  await execute('UPDATE stock_pieces SET code = ? WHERE id = ?', [code, id]);
  await execute('UPDATE inventory_items SET track_pieces = 1 WHERE id = ?', [inventoryItemId]);
  await rollUpOnHand(inventoryItemId);
  // Linking a cert here allocates it to every project this piece's cut children ever reach — same
  // documented convention as app/api/qc-documents/[id]/link-parts/route.js. Nothing to join to yet
  // (this piece has no project_id at receipt), but cutPiece() re-triggers this once one is known.
  return { id, code, weight_kg: round2(weight) };
}

// The Cut action (Production, BOM tab) — operator declares what was used and what usable remnant
// they kept; everything else (weight math, scrap, the remnant going back into stock, lineage) is
// computed, not typed. One transaction: the source piece, its used/remnant/scrap children, the
// on_hand rollup, and (if this was a reserved piece fulfilling a BOM line) that line's completion
// all move together or not at all.
export async function cutPiece({ sourcePieceId, used = [], remnants = [], projectId, bomItemId, jobCardId, username }) {
  const source = await queryOne('SELECT * FROM stock_pieces WHERE id = ?', [sourcePieceId]);
  if (!source) throw new Error('Source piece not found');
  if (!['available', 'reserved'].includes(source.status)) {
    throw new Error(`Can't cut — already ${source.status}`);
  }
  if (source.bom_item_id && !bomItemId) bomItemId = source.bom_item_id;
  if (source.project_id && !projectId) projectId = source.project_id;

  const dims = piece => ({ kind: source.kind, ...piece, density: source.density, kg_per_m: source.kg_per_m });
  const usedWeight = used.reduce((sum, u) => sum + pieceWeight(dims(u)), 0);
  const remnantWeight = remnants.reduce((sum, r) => sum + pieceWeight(dims(r)), 0);
  if (!(usedWeight > 0) && !(remnantWeight > 0)) throw new Error('Enter at least one used or remnant piece');
  if (usedWeight + remnantWeight > source.weight_kg + 0.01) {
    throw new Error(`Used + remnant (${round2(usedWeight + remnantWeight)} kg) exceeds the source piece (${source.weight_kg} kg)`);
  }
  const scrapWeight = Math.max(0, round2(source.weight_kg - usedWeight - remnantWeight));

  return withTransaction(async tx => {
    // Compare-and-swap, not a plain UPDATE: the earlier SELECT (line 66) already checked status
    // once, but that read happens before this transaction opens, so two concurrent cuts of the same
    // piece could both pass it and both proceed to insert a full child set — silently doubling
    // material that only existed once. Re-asserting the status transition atomically here, and
    // aborting before any child is inserted if another transaction already won, is what actually
    // prevents that (same pattern reservePiece() already uses correctly).
    const flip = await tx.execute({
      sql: "UPDATE stock_pieces SET status = 'consumed', cut_by = ?, cut_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('available', 'reserved')",
      args: [username || null, sourcePieceId],
    });
    if (Number(flip.rowsAffected) !== 1) throw new Error(`Can't cut — already ${source.status}`);

    let uIdx = 0, rIdx = 0;
    for (const u of used) {
      const w = pieceWeight(dims(u));
      // A present-but-invalid entry (0/blank/negative dims) must never be silently dropped: doing so
      // would let the scrap residual quietly absorb an operator's typo, making a real material
      // discrepancy look like a clean conservation. An intentionally-empty slot should never be sent
      // at all — that's the caller's job, not this function's to guess.
      if (!(w > 0)) throw new Error(`Used piece ${uIdx + 1}: enter valid dimensions`);
      uIdx++;
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m,
                                          weight_kg, status, source, parent_id, project_id, bom_item_id, job_card_id, cut_by, cut_at, heat_no, test_certificate_id, part_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'consumed', 'remnant', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, u.length_mm || null, u.width_mm || null, u.thickness_mm || null,
          source.density, source.kg_per_m, round2(w), sourcePieceId, projectId || null, bomItemId || null, jobCardId || null, username || null,
          source.heat_no || null, source.test_certificate_id || null, u.part_name || null],
      });
      await tx.execute({ sql: 'UPDATE stock_pieces SET code = ? WHERE id = ?', args: [`${source.code}-U${uIdx}`, Number(ins.lastInsertRowid)] });
    }
    for (const r of remnants) {
      const w = pieceWeight(dims(r));
      if (!(w > 0)) throw new Error(`Remnant ${rIdx + 1}: enter valid dimensions`);
      rIdx++;
      // pending_receipt, not 'available' (Phase 2, design 18.4): the cut is just the shop-floor
      // moment the remnant becomes real — nobody at Stores has actually put the physical piece back
      // on a shelf yet. Making it reservable/matchable the instant the cut is submitted would let a
      // remnant be claimed before it physically exists in Stores' hands. confirmPieceReceipt() below
      // is the one place this flips to 'available'; every existing status='available' filter
      // (the auto-matcher, reservePiece, on_hand's own rollup just below) needs zero changes to
      // correctly exclude a pending_receipt row — it simply isn't 'available' yet.
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m,
                                          weight_kg, status, source, parent_id, heat_no, test_certificate_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_receipt', 'remnant', ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, r.length_mm || null, r.width_mm || null, r.thickness_mm || null,
          source.density, source.kg_per_m, round2(w), sourcePieceId, source.heat_no || null, source.test_certificate_id || null],
      });
      await tx.execute({ sql: 'UPDATE stock_pieces SET code = ? WHERE id = ?', args: [`${source.code}-R${rIdx}`, Number(ins.lastInsertRowid)] });
    }
    if (scrapWeight > 0) {
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, parent_id, heat_no, test_certificate_id)
              VALUES (?, ?, ?, 'scrap', 'remnant', ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, scrapWeight, sourcePieceId, source.heat_no || null, source.test_certificate_id || null],
      });
      await tx.execute({ sql: 'UPDATE stock_pieces SET code = ? WHERE id = ?', args: [`${source.code}-S1`, Number(ins.lastInsertRowid)] });
    }

    // Cutting into a real project is the first point a receipt-time cert linkage is actually known
    // to belong to that project — auto-associate now, same convention as
    // app/api/qc-documents/[id]/link-parts/route.js ("using a cert on a project's folder is what
    // allocates it to that project").
    if (projectId && source.test_certificate_id) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)',
        args: [source.test_certificate_id, projectId],
      });
    }

    const countRow = await tx.execute({
      sql: "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available'",
      args: [source.inventory_item_id],
    });
    await tx.execute({ sql: 'UPDATE inventory_items SET on_hand = ? WHERE id = ?', args: [countRow.rows[0].n, source.inventory_item_id] });

    // A remnant-matched line (lib/remnant-match.js) can need more than one reserved piece to cover
    // its required qty — only flip the BOM line to the same 'In-Stock' terminal state
    // issueReservation() already uses (D9's stock-fulfilled convention) once every reserved piece
    // against it has actually been cut, not after the first one.
    if (bomItemId) {
      const remaining = await tx.execute({
        sql: "SELECT COUNT(*) AS n FROM stock_pieces WHERE bom_item_id = ? AND status = 'reserved'",
        args: [bomItemId],
      });
      if (remaining.rows[0].n === 0) {
        await tx.execute({ sql: "UPDATE bom_items SET purchase_status = 'In-Stock' WHERE id = ?", args: [bomItemId] });
      }
    }

    return { sourceId: sourcePieceId, usedWeight: round2(usedWeight), remnantWeight: round2(remnantWeight), scrapWeight };
  });
}

// Stores' physical-handoff confirmation (Phase 2, design 18.4) — the one place a cut remnant moves
// pending_receipt -> available, mirroring GIR's own open-then-confirmed pattern (this codebase's
// existing precedent for "the record and the physical act happen in two steps, not one"). A
// compare-and-swap, same lesson as cutPiece()'s own CAS fix: only a genuinely pending_receipt row
// can be confirmed, so a double-click can't double-count the rollup below.
export async function confirmPieceReceipt(pieceId) {
  const res = await execute(
    "UPDATE stock_pieces SET status = 'available' WHERE id = ? AND status = 'pending_receipt'",
    [pieceId]
  );
  if (res.changes !== 1) throw new Error('Piece is not pending receipt');
  const piece = await queryOne('SELECT inventory_item_id FROM stock_pieces WHERE id = ?', [pieceId]);
  await rollUpOnHand(piece.inventory_item_id);
  return { id: pieceId };
}

export async function listPieces({ inventoryItemId, bomItemId }) {
  // Receipt provenance (gap-closure round, 2026-08-26, S5/Q3) — receipt_id existed on the schema
  // and was written at receive time, but no query ever joined it back out, so "which supplier/PO/
  // inward batch did this piece come from" was only answerable via a raw SQL join outside the app.
  // Same join pattern as the pre-existing test_certificates join right below it.
  const select = `SELECT sp.*, tc.certificate_no AS certificate_no,
                          b.material_description AS bom_description, pr.project_no AS project_no,
                          sr.inward_batch_no AS receipt_inward_batch_no, s.name AS receipt_supplier_name
                     FROM stock_pieces sp
                     LEFT JOIN test_certificates tc ON tc.id = sp.test_certificate_id
                     LEFT JOIN bom_items b ON b.id = sp.bom_item_id
                     LEFT JOIN projects pr ON pr.id = sp.project_id
                     LEFT JOIN stock_receipts sr ON sr.id = sp.receipt_id
                     LEFT JOIN suppliers s ON s.id = sr.supplier_id`;
  if (bomItemId) {
    return queryAll(`${select} WHERE sp.bom_item_id = ? ORDER BY sp.id DESC`, [bomItemId]);
  }
  return queryAll(
    `${select} WHERE sp.inventory_item_id = ? ORDER BY sp.id DESC`,
    [inventoryItemId]
  );
}

// Frees a 'reserved' piece back to stock — used when a matched BOM line is cancelled/edited before
// Cut, same "never leave a reservation orphaned" lesson lib/procurement.js's releaseReservation
// already encodes for the plain-quantity reservation path.
export async function releasePiece(pieceId) {
  const piece = await queryOne('SELECT * FROM stock_pieces WHERE id = ?', [pieceId]);
  if (!piece) throw new Error('Piece not found');
  if (piece.status !== 'reserved') return piece;
  await execute("UPDATE stock_pieces SET status = 'available', bom_item_id = NULL WHERE id = ?", [pieceId]);
  return piece;
}

// Stores' manual counterpart to lib/remnant-match.js's automatic matchAndReserve — for the pieces
// the auto-matcher misses (near-miss dimensions, an unusual profile). Deliberately does NOT
// re-check material/category/dimension compatibility the way the auto-matcher does: a human
// picking a specific piece for a specific line is a trusted override, not a guess. It DOES block
// reserving against a BOM line that's no longer open (Received/In-Stock/Cancelled) — same
// "don't double-book material Stores already considers fulfilled" reasoning as the rest of this
// codebase's status guards.
export async function reservePiece({ pieceId, projectId, bomItemId }) {
  if (bomItemId) {
    const bomItem = await queryOne('SELECT id, project_id, purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
    if (!bomItem) throw new Error('BOM line not found');
    if (projectId && bomItem.project_id !== projectId) throw new Error('BOM line does not belong to that project');
    if (!isOpenStatus(bomItem.purchase_status)) {
      throw new Error(`BOM line is already ${bomItem.purchase_status} — can't reserve against it`);
    }
  }
  const res = await execute(
    "UPDATE stock_pieces SET status = 'reserved', project_id = ?, bom_item_id = ? WHERE id = ? AND status = 'available'",
    [projectId || null, bomItemId || null, pieceId]
  );
  if (res.changes !== 1) throw new Error('Piece not available to reserve');
  return { id: pieceId };
}
