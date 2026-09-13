import { NextResponse } from 'next/server';
import { queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireBomAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { parsePmb } from '@/lib/pmb.mjs';
import { getAllocationMode } from '@/lib/procurement';
import { findBlockedIds } from '@/lib/bom-item-guard';
import { buildAssemblyTreeFromImport } from '@/lib/bom-tree-from-import';
import { suggestCategoryFromGroups, suggestSpellingCorrection } from '@/lib/section-shapes';
import { normalizeWords } from '@/lib/match-utils';

// PMB (.xlsx) or CSV import — Engineering, Design, or PM (Design got the same BOM-entry capability
// as Engineering, 2026-08-25; CSV unified into this same pipeline the same day — parsePmb's
// underlying XLSX.read() autodetects a plain CSV buffer, verified directly against quoted-comma/
// CRLF/UTF-8-BOM edge cases, so this route needs no format branching at all). One stateless route,
// two phases:
//   POST file                      → parse only, return a preview (nothing written)
//   POST file + confirm=1          → insert (409 if a BOM already exists)
//   POST file + confirm=1&replace=1→ wipe this project's bom_items first, then insert
// The client holds the File object and re-posts the same bytes to confirm (files are ~50-120 KB),
// so there is no draft-import state to store or clean up. The original file is kept whole in
// bom_imports — that row IS the revision record.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // real files run ~50-120KB; this is defense-in-depth
// only — Render (unlike Vercel) has no platform request-body cap to lean on, and parsePmb reads the
// whole buffer into memory before the row-count check below even runs.
const MAX_IMPORT_ROWS = 5000; // ponytail: real PMB/CSV files are 50-500 rows; this exists to fail
// fast on a malformed/huge file rather than run thousands of sequential execute() calls. Raise if a
// legitimate file ever needs more.

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Engineering') && !canAccessDepartment(user, 'Design')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const actionDenied = await requireBomAction(user, 'engineering.bom.import');
  if (actionDenied) return actionDenied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` },
      { status: 400 });
  }

  let parsed;
  try {
    parsed = parsePmb(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read file: ${e.message}` }, { status: 400 });
  }
  if (!parsed.totalItems) {
    return NextResponse.json({ error: 'No BOM items found in this file' }, { status: 400 });
  }
  if (parsed.totalItems > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `File has ${parsed.totalItems} rows — the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.` },
      { status: 400 });
  }

  // §3.2 catalog wiring, resolved BEFORE the preview branch below (not just at confirm time) so the
  // preview dialog and the actual insert always agree on the same category — a real inconsistency
  // this would otherwise introduce: the preview used to show parsePmb()'s own regex-only guess while
  // a catalog-aware category (added here) would silently differ once actually written.
  //
  // Once a row exact-name-matches a real catalog item, that item's own `bom_category` — the client's
  // real ERP-classified data (lib/db.js's backfillItemBomCategory) or a category picked by hand on
  // the Item Master screen — is authoritative and replaces the regex guess entirely, the same
  // "item.bom_category wins outright" rule the manual single-line composer already uses
  // (components/BomLineFields.jsx's ItemSearchField.pick()). Falls back to the regex guess when the
  // catalog row itself has no bom_category set (~19% of the real catalog, left NULL on purpose
  // rather than guessed at catalog-backfill scale) — never leaves a matched row worse off than an
  // unmatched one.
  const catalog = await queryAll('SELECT id, item_name, bom_category FROM items');
  const catalogByName = new Map(catalog.map(c => [c.item_name.trim().toLowerCase().replace(/\s+/g, ' '), c]));
  // Tier 2 — a fuzzy fallback for whatever still has no category at all after both an exact catalog
  // match AND inferCategory()'s own regex have had a chance (lib/section-shapes.js's
  // suggestCategoryFromGroups, scoped to internally-consistent group_name values only — see its own
  // comment for why, and for the real regression numbers behind ordering it strictly as a fallback,
  // never a competing signal that could override an already-correct regex answer).
  const groupRows = await queryAll(
    `SELECT group_name, bom_category FROM items
     WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL
     GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`);
  const groups = groupRows.map(g => ({ name: g.group_name, category: g.bom_category }));
  for (const sheet of parsed.sheets) {
    for (const it of sheet.items) {
      const match = catalogByName.get(String(it.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
      it.item_id = match?.id || null;
      if (match?.bom_category) {
        it.category = match.bom_category;
      } else if (!it.category) {
        const fuzzy = suggestCategoryFromGroups(it.material_description, groups);
        if (fuzzy) it.category = fuzzy;
      }
    }
  }

  // Tier 3 — learned spelling corrections (2026-09-13): a human already resolved this exact typo
  // once before, via the suggestion tier below and the confirm-time persistence at the bottom of
  // this route. Checked only after catalog + regex + fuzzy group have all had their turn — same
  // strictly-additive-fallback ordering §5cc's own suggestCategoryFromGroups already established,
  // never a competing signal that could override an already-correct answer.
  const corrections = await queryAll('SELECT word, category FROM category_word_corrections');
  if (corrections.length) {
    const correctionMap = new Map(corrections.map(c => [c.word.toUpperCase(), c.category]));
    for (const sheet of parsed.sheets) {
      for (const it of sheet.items) {
        if (it.category) continue;
        for (const w of normalizeWords(it.material_description || '')) {
          const hit = correctionMap.get(w.toUpperCase());
          if (hit) { it.category = hit; break; }
        }
      }
    }
  }

  // Tier 4 — nothing confirmed yet for this word: offer a "did you mean X?" guess for the preview
  // screen to show, never applied automatically. This is the actual "ask the user, then remember
  // the answer" loop — the previous round's TINNER/PALTE fixes were hand-added regex variants for
  // typos already known about; this is what closes the gap for a typo nobody's seen yet.
  for (const sheet of parsed.sheets) {
    for (const it of sheet.items) {
      if (!it.category) {
        const suggestion = suggestSpellingCorrection(it.material_description);
        if (suggestion) it.category_suggestion = suggestion;
      }
    }
  }

  // Scoped to import_id IS NOT NULL — a Replace only ever tears down what a *previous* PMB/CSV
  // import put here, never a PR-raised line (bom_items.pr_item_id), a manually-added row, or a
  // structure-template-applied one. Those three origins have nothing to do with "I uploaded a
  // corrected Excel file" and must survive it.
  const pmbItems = await queryAll(
    'SELECT id FROM bom_items WHERE project_id = ? AND import_id IS NOT NULL', [params.id]);
  const pmbIds = pmbItems.map(r => r.id);
  // Of those, which ones have real downstream activity (a supplier quote, a PO line, a packing
  // link, a QC record, ...) and must survive Replace regardless of origin — deleting one would
  // either throw a raw FK constraint error or (packing_items/supplier_quotes specifically) silently
  // destroy real history this app never lets anyone delete anywhere else. Checked once, in bulk
  // (a fixed ~19 queries regardless of how many PMB rows exist) — see lib/bom-item-guard.js for the
  // full table list and why it's schema-derived, not hand-picked.
  const blockedIds = await findBlockedIds(pmbIds);
  const deletableIds = pmbIds.filter(id => !blockedIds.has(id));
  const existing = { n: pmbIds.length };
  // Informational only — surfaced so the Replace warning can say what's being *kept*, not just
  // what's being wiped. Never affects the DELETE scope itself.
  const preserved = await queryOne(
    'SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ? AND import_id IS NULL', [params.id]);

  if (form.get('confirm') !== '1') {
    return NextResponse.json({
      preview: {
        filename: file.name,
        sheets: parsed.sheets.map(s => ({
          name: s.name,
          headerRow: s.headerRow,
          error: s.error || null,
          columns: s.columns,
          unmappedColumns: s.unmappedColumns,
          itemCount: s.items.length,
          sample: s.items.slice(0, 5),
          // Full per-row list (lean shape — just enough to judge a category, not every column) so
          // the preview UI can show/override the best-effort inferred category on every row before
          // anything is written, not just the first 5. `sample` above is left untouched (existing
          // 3-item summary line).
          items: s.items.map(it => ({
            material_description: it.material_description, moc: it.moc, category: it.category,
            category_suggestion: it.category_suggestion || null,
          })),
          skipped: s.skipped,
        })),
        totalItems: parsed.totalItems,
        totalSkipped: parsed.totalSkipped,
        existingItems: existing.n,
        blockedCount: blockedIds.size,
        preservedCount: preserved.n,
      },
    });
  }

  if (existing.n > 0 && form.get('replace') !== '1') {
    return NextResponse.json(
      { error: 'This project already has a BOM — replacing it must be explicit' }, { status: 409 });
  }
  const replacing = existing.n > 0;

  const prev = await queryOne(
    'SELECT MAX(revision) AS r FROM bom_imports WHERE project_id = ?', [params.id]);
  const revision = (prev?.r || 0) + 1;
  const summary = JSON.stringify(parsed.sheets.map(s => ({
    name: s.name, items: s.items.length, skipped: s.skipped.length,
  })));

  // Allocation Mode gate, refined 2026-08-20 — applies only to genuinely fresh rows (a row
  // carrying a real historical status from the client's own PMB export, e.g. already Received,
  // skips it entirely; it doesn't need Stores' review, it's already resolved). Manual mode keeps
  // every fresh row gated (pending_review=1, the original behavior); Auto mode leaves them open
  // (0) so release-bom's auto-match pass (matchProjectBom / matchProjectPlainStock) decides.
  const allocationMode = await getAllocationMode();
  const freshPendingReview = allocationMode === 'manual' ? 1 : 0;

  // Sparse category overrides from the preview screen — keyed "sheetIndex-itemIndex" (only rows the
  // user actually changed from parsePmb's own best-effort inference), applied at insert time below.
  // The file is re-parsed from the same bytes on confirm (this route's own stateless design, see the
  // header comment) so indices here must match parseSheet's own item order exactly — unaffected by
  // anything else, since neither sheets nor items are reordered between the two calls.
  let categoryOverrides = {};
  try {
    const raw = form.get('categoryOverrides');
    if (raw) categoryOverrides = JSON.parse(raw);
  } catch { categoryOverrides = {}; }

  // Replace-delete, the revision record, and every item insert happen in one transaction — a
  // failure partway through (network drop, DB hiccup) previously could leave the project with fewer
  // items than either the old or new BOM (worst on the replace path, which deletes first). Side
  // effects (audit, Stores notification) stay outside, per withTransaction's own convention, and
  // only run once the transaction has actually committed.
  const { importId, n, tree, learned } = await withTransaction(async tx => {
    if (replacing && deletableIds.length) {
      // deletableIds, not a blanket `import_id IS NOT NULL` — a PR-raised/manual/template row must
      // never be swept up (see the comment above `pmbItems` earlier in this route), and neither may
      // a PMB-imported row that already has real downstream activity (blockedIds above) — deleting
      // one would throw a raw FK constraint error (Turso enforces them) or silently cascade away
      // real history (supplier_quotes).
      await tx.execute({
        sql: `DELETE FROM bom_items WHERE id IN (${deletableIds.map(() => '?').join(',')})`,
        args: deletableIds,
      });
    }

    const imp = await tx.execute({
      sql: `INSERT INTO bom_imports (project_id, filename, file, revision, summary, imported_by)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [params.id, file.name, buffer, revision, summary, user.username],
    });
    const importId = Number(imp.lastInsertRowid);

    // Confirm-time learning: a real, deliberate human decision, so one confirmation is enough to
    // promote it (unlike tc_item_match_approvals' multi-approval promotion, §5at, which is scoring
    // an inferred match rather than recording an explicit yes/no). Keyed by word so the same typo
    // fixed twice in one file only writes once; INSERT OR REPLACE below lets a later correct answer
    // for the same word supersede an earlier, possibly wrong one.
    const learnedCorrections = new Map();

    let n = 0;
    for (let sheetIndex = 0; sheetIndex < parsed.sheets.length; sheetIndex++) {
      const sheet = parsed.sheets[sheetIndex];
      for (let itemIndex = 0; itemIndex < sheet.items.length; itemIndex++) {
        const it = sheet.items[itemIndex];
        const overrideKey = `${sheetIndex}-${itemIndex}`;
        const category = Object.prototype.hasOwnProperty.call(categoryOverrides, overrideKey)
          ? (categoryOverrides[overrideKey] || null) : it.category;
        if (it.category_suggestion && category === it.category_suggestion.category) {
          learnedCorrections.set(it.category_suggestion.word.toUpperCase(), category);
        }
        await tx.execute({
          sql: `INSERT INTO bom_items
                  (project_id, material_description, moc, size_spec, sort_order, section, group_label,
                   make, qty_text, purchase_status, pr_ref, po_ref, grn_ref, grn_qty_text,
                   pending_qty_text, bqtc_ref, issued_ref, received_ref, remarks, import_id, pending_review, item_id, category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [params.id, it.material_description, it.moc, it.size_spec, n, it.section, it.group_label,
            it.make, it.qty_text, it.purchase_status, it.pr_ref, it.po_ref, it.grn_ref,
            it.grn_qty_text, it.pending_qty_text, it.bqtc_ref, it.issued_ref, it.received_ref,
            it.remarks, importId, it.purchase_status ? 0 : freshPendingReview, it.item_id, category],
        });
        n++;
      }
    }

    // Auto-builds bom_assemblies from this import's own section/group_label data — same
    // transaction as the insert loop above, so a failure here can't leave items inserted with no
    // tree built for them. Scoped to importId, so it only ever touches rows just inserted above.
    const tree = await buildAssemblyTreeFromImport({ tx, projectId: Number(params.id), importId, username: user.username });

    for (const [word, category] of learnedCorrections) {
      await tx.execute({
        sql: 'INSERT OR REPLACE INTO category_word_corrections (word, category, confirmed_by) VALUES (?, ?, ?)',
        args: [word, category, user.username],
      });
    }

    return { importId, n, tree, learned: learnedCorrections.size };
  });

  await audit(replacing ? 'bom_replace' : 'bom_import', {
    actor: user.username,
    detail: JSON.stringify({
      project_id: Number(params.id), filename: file.name, revision,
      inserted: n, skipped: parsed.totalSkipped, previous_items: existing.n,
    }),
  });
  if (tree.itemsAssigned > 0) {
    await audit('bom_assembly_auto_build', {
      actor: user.username,
      detail: JSON.stringify({ project_id: Number(params.id), import_id: importId, ...tree }),
    });
  }

  // STORES-SALES-CHANGES.md §3.1 — Stores previously heard about a new BOM only by opening the
  // workbench and eyeballing it. Best-effort, outside the insert loop above (already committed).
  if (n > 0) {
    try {
      const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [params.id]);
      await notifyDepartment('Stores', {
        kind: 'bom_released', title: `New BOM: ${project?.project_no || params.id}`,
        body: `${n} item(s)`, dedupe_key: `bom_import:${importId}`,
      });
    } catch (err) { /* notification is best-effort */ }
  }

  return NextResponse.json({ importId, revision, inserted: n, skipped: parsed.totalSkipped, tree, learned });
}
