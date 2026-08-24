// lib/stock-pieces.js — Cutting & Remnant Management, the cut/lineage half. A piece-tracked
// inventory_items row (track_pieces=1) holds a list of stock_pieces instead of a hand-edited
// on_hand number; on_hand becomes a rollup (count of 'available' pieces) so the existing Stores
// Inventory table keeps working unmodified. See lib/remnant-match.js for the other half (matching
// a BOM line's required dimensions against this stock automatically at BOM release).
import { execute, queryOne, queryAll, withTransaction } from './db';
import { isOpenStatus } from './bom-fields.mjs';
import { pieceWeight, DEFAULT_DENSITY } from './piece-weight.js';

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
export async function receivePiece({ inventoryItemId, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, heat_no, test_certificate_id, username }) {
  const invItem = await queryOne('SELECT * FROM inventory_items WHERE id = ?', [inventoryItemId]);
  if (!invItem) throw new Error('Inventory item not found');
  if (test_certificate_id) {
    const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [test_certificate_id]);
    if (!cert) throw new Error('Test certificate not found');
  }
  const weight = pieceWeight({ kind, length_mm, width_mm, thickness_mm, density, kg_per_m });
  if (!(weight > 0)) throw new Error('Enter valid dimensions');

  const { lastId } = await execute(
    `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, weight_kg, status, source, heat_no, test_certificate_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', 'purchase', ?, ?)`,
    [inventoryItemId, kind, length_mm || null, width_mm || null, thickness_mm || null,
      kind === 'plate' ? (Number(density) || DEFAULT_DENSITY) : null, kind === 'linear' ? Number(kg_per_m) : null,
      round2(weight), heat_no || null, test_certificate_id || null]
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
    await tx.execute({
      sql: "UPDATE stock_pieces SET status = 'consumed', cut_by = ?, cut_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [username || null, sourcePieceId],
    });

    let uIdx = 0, rIdx = 0;
    for (const u of used) {
      const w = pieceWeight(dims(u));
      if (!(w > 0)) continue;
      uIdx++;
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m,
                                          weight_kg, status, source, parent_id, project_id, bom_item_id, job_card_id, cut_by, cut_at, heat_no, test_certificate_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'consumed', 'remnant', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        args: [source.inventory_item_id, source.kind, u.length_mm || null, u.width_mm || null, u.thickness_mm || null,
          source.density, source.kg_per_m, round2(w), sourcePieceId, projectId || null, bomItemId || null, jobCardId || null, username || null,
          source.heat_no || null, source.test_certificate_id || null],
      });
      await tx.execute({ sql: 'UPDATE stock_pieces SET code = ? WHERE id = ?', args: [`${source.code}-U${uIdx}`, Number(ins.lastInsertRowid)] });
    }
    for (const r of remnants) {
      const w = pieceWeight(dims(r));
      if (!(w > 0)) continue;
      rIdx++;
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m,
                                          weight_kg, status, source, parent_id, heat_no, test_certificate_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', 'remnant', ?, ?, ?)`,
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

export async function listPieces({ inventoryItemId, bomItemId }) {
  const select = `SELECT sp.*, tc.certificate_no AS certificate_no,
                          b.material_description AS bom_description, pr.project_no AS project_no
                     FROM stock_pieces sp
                     LEFT JOIN test_certificates tc ON tc.id = sp.test_certificate_id
                     LEFT JOIN bom_items b ON b.id = sp.bom_item_id
                     LEFT JOIN projects pr ON pr.id = sp.project_id`;
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
