import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireBomAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { parsePmb } from '@/lib/pmb.mjs';
import { getAllocationMode } from '@/lib/procurement';

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

  const existing = await queryOne(
    'SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [params.id]);
  const packed = await queryOne(
    `SELECT COUNT(DISTINCT b.id) AS n FROM bom_items b
     JOIN packing_items p ON p.bom_item_id = b.id WHERE b.project_id = ?`, [params.id]);

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
          skipped: s.skipped,
        })),
        totalItems: parsed.totalItems,
        totalSkipped: parsed.totalSkipped,
        existingItems: existing.n,
        packedCount: packed.n,
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

  // §3.2 catalog wiring — best-effort auto-link: PMB descriptions and the client's own Item Master
  // export both ultimately came from the same ERP system, so an exact (case/space-insensitive)
  // name match is a real signal, not a guess, worth taking automatically here (unlike the fuzzy
  // keyword overlap the possible-match badge uses elsewhere). No match just leaves item_id NULL —
  // same as any row nobody's linked yet.
  const catalog = await queryAll('SELECT id, item_name FROM items');
  const catalogByName = new Map(catalog.map(c => [c.item_name.trim().toLowerCase().replace(/\s+/g, ' '), c.id]));
  // Allocation Mode gate, refined 2026-08-20 — applies only to genuinely fresh rows (a row
  // carrying a real historical status from the client's own PMB export, e.g. already Received,
  // skips it entirely; it doesn't need Stores' review, it's already resolved). Manual mode keeps
  // every fresh row gated (pending_review=1, the original behavior); Auto mode leaves them open
  // (0) so release-bom's auto-match pass (matchProjectBom / matchProjectPlainStock) decides.
  const allocationMode = await getAllocationMode();
  const freshPendingReview = allocationMode === 'manual' ? 1 : 0;

  // Replace-delete, the revision record, and every item insert happen in one transaction — a
  // failure partway through (network drop, DB hiccup) previously could leave the project with fewer
  // items than either the old or new BOM (worst on the replace path, which deletes first). Side
  // effects (audit, Stores notification) stay outside, per withTransaction's own convention, and
  // only run once the transaction has actually committed.
  const { importId, n } = await withTransaction(async tx => {
    if (replacing) {
      await tx.execute({ sql: 'DELETE FROM bom_items WHERE project_id = ?', args: [params.id] });
    }

    const imp = await tx.execute({
      sql: `INSERT INTO bom_imports (project_id, filename, file, revision, summary, imported_by)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [params.id, file.name, buffer, revision, summary, user.username],
    });
    const importId = Number(imp.lastInsertRowid);

    let n = 0;
    for (const sheet of parsed.sheets) {
      for (const it of sheet.items) {
        const itemId = catalogByName.get(String(it.material_description || '').trim().toLowerCase().replace(/\s+/g, ' ')) || null;
        await tx.execute({
          sql: `INSERT INTO bom_items
                  (project_id, material_description, moc, size_spec, sort_order, section, group_label,
                   make, qty_text, purchase_status, pr_ref, po_ref, grn_ref, grn_qty_text,
                   pending_qty_text, bqtc_ref, issued_ref, received_ref, remarks, import_id, pending_review, item_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [params.id, it.material_description, it.moc, it.size_spec, n, it.section, it.group_label,
            it.make, it.qty_text, it.purchase_status, it.pr_ref, it.po_ref, it.grn_ref,
            it.grn_qty_text, it.pending_qty_text, it.bqtc_ref, it.issued_ref, it.received_ref,
            it.remarks, importId, it.purchase_status ? 0 : freshPendingReview, itemId],
        });
        n++;
      }
    }
    return { importId, n };
  });

  await audit(replacing ? 'bom_replace' : 'bom_import', {
    actor: user.username,
    detail: JSON.stringify({
      project_id: Number(params.id), filename: file.name, revision,
      inserted: n, skipped: parsed.totalSkipped, previous_items: existing.n,
    }),
  });

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

  return NextResponse.json({ importId, revision, inserted: n, skipped: parsed.totalSkipped });
}
