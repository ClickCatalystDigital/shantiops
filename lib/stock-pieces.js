// lib/stock-pieces.js — Cutting & Remnant Management, the cut/lineage half. A piece-tracked
// inventory_items row (track_pieces=1) holds a list of stock_pieces instead of a hand-edited
// on_hand number; on_hand becomes a rollup (count of 'available' pieces) so the existing Stores
// Inventory table keeps working unmodified. See lib/remnant-match.js for the other half (matching
// a BOM line's required dimensions against this stock automatically at BOM release).
import { execute, queryOne, queryAll, withTransaction } from './db';
import { isOpenStatus, isClosedStatus, DEFAULT_PURCHASE_STATUS } from './bom-fields.mjs';
import { pieceWeight, DEFAULT_DENSITY } from './piece-weight.js';
import { assertTrackingMode } from './tracking-mode';
import { notifyDepartment } from './notify';
import { audit } from './usb';

export { pieceWeight };

function round2(n) { return Math.round(n * 100) / 100; }

// owner_project_id IS NULL — Stores/Inventory hardening Phase 2's ownership guard #1. on_hand is
// the shared/common-pool figure every existing consumer reads (Stores' Inventory list, Reorder
// Suggestions); a project-owned piece must never inflate it, or it would silently read as
// available to any other project's demand. See the plan doc's "ownership-leak proof" section.
async function rollUpOnHand(inventoryItemId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available' AND owner_project_id IS NULL",
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
//
// ownerProjectId (Stores/Inventory hardening Phase 2, optional) — Ownership, not Reservation
// (plan doc invariant #8): which project this piece is restricted to serving, set once here at
// physical receipt, independent of whether/when it's later reserved against a specific demand line.
// Omitted (the generic Stores manual-receive path, unchanged) = common/anonymous pool, exactly
// today's behavior. Set only by lib/bom-receiving.js's maybeCreatePieceStock, for PMB/PR-procured
// dimensional material received against a real project.
export async function receivePiece({ inventoryItemId, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, heat_no, test_certificate_id, bomItemId, receiptId, ownerProjectId, username }) {
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
    `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m, weight_kg, status, source, heat_no, test_certificate_id, receipt_id, owner_project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', 'purchase', ?, ?, ?, ?)`,
    [inventoryItemId, kind, length_mm || null, width_mm || null, thickness_mm || null,
      kind === 'plate' ? (Number(density) || DEFAULT_DENSITY) : null, kind === 'linear' ? Number(kg_per_m) : null,
      round2(weight), heat_no || null, test_certificate_id || null, receiptId || null, ownerProjectId || null]
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
  // Material Indent hard gate (Feature B, 2026-09-02) — a piece may only be cut once it's
  // 'reserved', never while merely 'available'. The only two ways a piece now reaches 'reserved'
  // are the pre-existing automatic BOM match (lib/remnant-match.js, an already-governed event —
  // Design releasing a BOM line) or a Stores-authorized indent release
  // (POST /api/material-indents/[id]/items/[itemId]/reserve-piece). Cutting a bare 'available'
  // piece — the previous loophole this closes — is no longer possible through any path.
  if (source.status !== 'reserved') {
    throw new Error(`Can't cut — must be reserved first (currently ${source.status})`);
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
      sql: "UPDATE stock_pieces SET status = 'consumed', cut_by = ?, cut_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'reserved'",
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
                                          weight_kg, status, source, parent_id, project_id, bom_item_id, job_card_id, cut_by, cut_at, heat_no, test_certificate_id, part_name, owner_project_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'consumed', 'remnant', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, u.length_mm || null, u.width_mm || null, u.thickness_mm || null,
          source.density, source.kg_per_m, round2(w), sourcePieceId, projectId || null, bomItemId || null, jobCardId || null, username || null,
          source.heat_no || null, source.test_certificate_id || null, u.part_name || null, source.owner_project_id || null],
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
      // owner_project_id inherited from the source (Stores/Inventory hardening Phase 2) — without
      // this a remnant of an owned piece would default to NULL (anonymous common stock) the instant
      // it's cut, silently defeating the whole point of tracking ownership at all.
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, length_mm, width_mm, thickness_mm, density, kg_per_m,
                                          weight_kg, status, source, parent_id, heat_no, test_certificate_id, owner_project_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_receipt', 'remnant', ?, ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, r.length_mm || null, r.width_mm || null, r.thickness_mm || null,
          source.density, source.kg_per_m, round2(w), sourcePieceId, source.heat_no || null, source.test_certificate_id || null, source.owner_project_id || null],
      });
      await tx.execute({ sql: 'UPDATE stock_pieces SET code = ? WHERE id = ?', args: [`${source.code}-R${rIdx}`, Number(ins.lastInsertRowid)] });
    }
    if (scrapWeight > 0) {
      const ins = await tx.execute({
        sql: `INSERT INTO stock_pieces (inventory_item_id, kind, weight_kg, status, source, parent_id, heat_no, test_certificate_id, owner_project_id)
              VALUES (?, ?, ?, 'scrap', 'remnant', ?, ?, ?, ?)`,
        args: [source.inventory_item_id, source.kind, scrapWeight, sourcePieceId, source.heat_no || null, source.test_certificate_id || null, source.owner_project_id || null],
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

    // owner_project_id IS NULL — same ownership guard as rollUpOnHand() above; this is a separate,
    // inline duplicate of that same count (not a call to the function, since it must run inside
    // this transaction), so it needs the identical fix, not just the shared helper.
    const countRow = await tx.execute({
      sql: "SELECT COUNT(*) AS n FROM stock_pieces WHERE inventory_item_id = ? AND status = 'available' AND owner_project_id IS NULL",
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

// Stores/Inventory hardening Phase 4 — Ownership Transfer. Explicit, auditable, never silent: a
// piece's ownership only ever moves through this one function (or receipt/inheritance at creation/
// cut — never an ad hoc direct write anywhere else, confirmed by Phase 3+4 research: zero routes
// touch owner_project_id today outside this file). `toProjectId` may be null (transfer to the
// common/anonymous pool). Force-releases any active reservation FIRST via releasePiece() — which,
// as of this same phase, already reopens the originating demand + notifies Stores if that demand is
// still open and was relying on this exact piece — so a transfer can never leave a demand silently
// looking fulfilled when the material backing it just moved elsewhere. Only ever touches
// stock_pieces.owner_project_id: confirmed by the Phase 3+4 research pass that this column sits
// outside every entity-ID/traceability chain (Item Master -> inventory_items -> stock_pieces ->
// bom_items -> pr_items), so a transfer can never break traceability, only ever change who's
// currently allowed to draw on the piece. Cost/value implications of the transfer are deliberately
// NOT touched here — isolated per instruction, pending an explicit business decision.
export async function transferPieceOwnership(pieceId, { toProjectId = null, reason, username }) {
  const piece = await queryOne('SELECT * FROM stock_pieces WHERE id = ?', [pieceId]);
  if (!piece) throw new Error('Piece not found');
  if (['consumed', 'scrap'].includes(piece.status)) {
    throw new Error(`Can't transfer ownership — piece is already ${piece.status}`);
  }
  const fromProjectId = piece.owner_project_id;
  if ((fromProjectId ?? null) === (toProjectId ?? null)) {
    throw new Error(toProjectId ? 'Already owned by that project' : 'Already common (unowned)');
  }

  await releasePiece(pieceId); // no-op if already 'available'; reopens the demand if applicable
  await execute('UPDATE stock_pieces SET owner_project_id = ? WHERE id = ?', [toProjectId ?? null, pieceId]);

  await audit('stock_piece_ownership_transferred', {
    actor: username,
    detail: `piece ${pieceId} (${piece.code || pieceId}): project ${fromProjectId ?? 'common'} -> ${toProjectId ?? 'common'}${reason ? ` — ${reason}` : ''}`,
  });
  return { id: pieceId, from: fromProjectId, to: toProjectId ?? null };
}

export async function listPieces({ inventoryItemId, bomItemId }) {
  // Receipt provenance (gap-closure round, 2026-08-26, S5/Q3) — receipt_id existed on the schema
  // and was written at receive time, but no query ever joined it back out, so "which supplier/PO/
  // inward batch did this piece come from" was only answerable via a raw SQL join outside the app.
  // Same join pattern as the pre-existing test_certificates join right below it.
  // PR traceability (gap-closure round) — b.pr_item_id -> pr_items -> purchase_requisitions.pr_no,
  // the same join precedent lib/data.js's getSourcingItems()/getBomStructure() already use. `pr` is
  // already taken as the projects alias above, so `pri`/`preq` here.
  const select = `SELECT sp.*, tc.certificate_no AS certificate_no,
                          b.material_description AS bom_description, pr.project_no AS project_no,
                          sr.inward_batch_no AS receipt_inward_batch_no, s.name AS receipt_supplier_name,
                          mi.indent_no AS indent_no, mi.job_card_id AS indent_job_card_id,
                          mi.requested_by AS indent_requested_by, mi.project_id AS indent_project_id,
                          preq.pr_no AS pr_no, preq.created_at AS pr_created_at, b.pr_ref AS pr_ref
                     FROM stock_pieces sp
                     LEFT JOIN test_certificates tc ON tc.id = sp.test_certificate_id
                     LEFT JOIN bom_items b ON b.id = sp.bom_item_id
                     LEFT JOIN projects pr ON pr.id = sp.project_id
                     LEFT JOIN stock_receipts sr ON sr.id = sp.receipt_id
                     LEFT JOIN suppliers s ON s.id = sr.supplier_id
                     LEFT JOIN material_indent_items mii ON mii.id = sp.indent_item_id
                     LEFT JOIN material_indents mi ON mi.id = mii.indent_id
                     LEFT JOIN pr_items pri ON pri.id = b.pr_item_id
                     LEFT JOIN purchase_requisitions preq ON preq.id = pri.pr_id`;
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
//
// Stores/Inventory hardening Phase 4 — now mirrors releaseReservation()'s own self-adapting
// reopen+notify pattern exactly (the same invariant-6 enforcement the scalar path already had,
// pieces didn't): if the line this piece was satisfying is still open and still gated
// (pending_review) after release, Stores gets notified it needs a fresh Reserve/Procure decision —
// a released piece must never leave a demand silently looking "fulfilled" when it no longer is.
// Self-guards to a no-op when the line is already terminal — cancellation sets
// purchase_status='Cancelled' BEFORE calling this (app/api/bom-items/[id]/cancel/route.js via
// releaseReservationsForItem), so the cancel path needs no special-casing here: it already,
// correctly, triggers no reopen/notify, exactly as intended (a cancelled demand isn't reopening).
export async function releasePiece(pieceId) {
  const piece = await queryOne('SELECT * FROM stock_pieces WHERE id = ?', [pieceId]);
  if (!piece) throw new Error('Piece not found');
  if (piece.status !== 'reserved') return piece;
  // indent_item_id must be cleared alongside bom_item_id (Material Indent gap-fix) — reservePiece()
  // itself never touches this column (only the reserve-piece route stamps it, after the fact), so a
  // stale value left here would silently follow the piece into its NEXT reservation if that one
  // comes from the automatic BOM-match path instead of a fresh indent — surfacing this piece in the
  // indent-only Cut picker (components/PlanningWorkspace.jsx) under a cancelled/unrelated indent's
  // context even though it's now correctly reserved for a real BOM line.
  const bomItemId = piece.bom_item_id;
  await execute("UPDATE stock_pieces SET status = 'available', bom_item_id = NULL, indent_item_id = NULL WHERE id = ?", [pieceId]);

  if (bomItemId) {
    const item = await queryOne(
      'SELECT id, material_description, pending_review, purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
    if (item?.pending_review && !isClosedStatus(item.purchase_status || DEFAULT_PURCHASE_STATUS)) {
      try {
        await notifyDepartment('Stores', {
          kind: 'bom_released', title: 'Reservation released — needs a decision',
          body: item.material_description, dedupe_key: `piece_released:${pieceId}`,
        });
      } catch (err) { /* notification is best-effort */ }
    }
  }
  return piece;
}

// Stores' manual counterpart to lib/remnant-match.js's automatic matchAndReserve — for the pieces
// the auto-matcher misses (near-miss dimensions, an unusual profile). Deliberately does NOT
// re-check material/category/dimension compatibility the way the auto-matcher does: a human
// picking a specific piece for a specific line is a trusted override, not a guess. It DOES block
// reserving against a BOM line that's no longer open (Received/In-Stock/Cancelled) — same
// "don't double-book material Stores already considers fulfilled" reasoning as the rest of this
// codebase's status guards.
// allowClosedStatus (Stores/Inventory hardening Phase 5, default false — every existing caller
// unaffected) — the one legitimate exception to the isOpenStatus guard below: the system linking a
// piece to the very bom_item it was JUST received for (lib/bom-receiving.js's maybeCreatePieceStock).
// By the time that runs, the line's own purchase_status is already 'Received' (the receipt is what
// created the piece in the first place) — semantically this isn't "reserve stock against a
// closed/resolved line" (the business rule this guard exists to enforce for a human's *manual*
// reserve action), it's the system completing the one physical link a receipt always implies. Every
// other caller (the manual reserve routes) omits this and keeps the guard exactly as before.
export async function reservePiece({ pieceId, projectId, bomItemId, allowClosedStatus = false }) {
  if (bomItemId) {
    const bomItem = await queryOne('SELECT id, project_id, purchase_status FROM bom_items WHERE id = ?', [bomItemId]);
    if (!bomItem) throw new Error('BOM line not found');
    if (projectId && bomItem.project_id !== projectId) throw new Error('BOM line does not belong to that project');
    if (!allowClosedStatus && !isOpenStatus(bomItem.purchase_status)) {
      throw new Error(`BOM line is already ${bomItem.purchase_status} — can't reserve against it`);
    }
  }
  // Stores/Inventory hardening Phase 2 — ownership guard #3, defense in depth. This is the single
  // choke point behind BOTH manual-reserve entry points (the direct stock-pieces route and the
  // material-indent reserve-piece route) — correctness here can never depend on the matching/
  // suggestion layer (findCandidates()) alone having filtered correctly first; a forged or direct
  // call must be rejected the same way. A project may still reserve its own owned-but-idle piece
  // (that's the normal "reuse it for the same project" case) or true common stock (owner NULL) —
  // only a DIFFERENT project's owned piece is blocked, and only an Ownership Transfer (Phase 4) can
  // cross that line.
  const piece = await queryOne('SELECT owner_project_id FROM stock_pieces WHERE id = ?', [pieceId]);
  if (piece?.owner_project_id != null && piece.owner_project_id !== projectId) {
    throw new Error("This piece belongs to another project — it can't be reserved here without an ownership transfer");
  }
  const res = await execute(
    "UPDATE stock_pieces SET status = 'reserved', project_id = ?, bom_item_id = ? WHERE id = ? AND status = 'available'",
    [projectId || null, bomItemId || null, pieceId]
  );
  if (res.changes !== 1) throw new Error('Piece not available to reserve');
  return { id: pieceId };
}
