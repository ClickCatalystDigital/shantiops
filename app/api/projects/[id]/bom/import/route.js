import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { parsePmb } from '@/lib/pmb.mjs';

// PMB (.xlsx) import — Engineering (or PM) only. One stateless route, two phases:
//   POST file                      → parse only, return a preview (nothing written)
//   POST file + confirm=1          → insert (409 if a BOM already exists)
//   POST file + confirm=1&replace=1→ wipe this project's bom_items first, then insert
// The client holds the File object and re-posts the same bytes to confirm (files are ~50-120 KB),
// so there is no draft-import state to store or clean up. The original .xlsx is kept whole in
// bom_imports — that row IS the revision record.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No .xlsx file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parsePmb(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read workbook: ${e.message}` }, { status: 400 });
  }
  if (!parsed.totalItems) {
    return NextResponse.json({ error: 'No BOM items found in this workbook' }, { status: 400 });
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
  if (replacing) {
    await execute('DELETE FROM bom_items WHERE project_id = ?', [params.id]);
  }

  const prev = await queryOne(
    'SELECT MAX(revision) AS r FROM bom_imports WHERE project_id = ?', [params.id]);
  const revision = (prev?.r || 0) + 1;
  const summary = JSON.stringify(parsed.sheets.map(s => ({
    name: s.name, items: s.items.length, skipped: s.skipped.length,
  })));
  const imp = await execute(
    `INSERT INTO bom_imports (project_id, filename, file, revision, summary, imported_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, file.name, buffer, revision, summary, user.username]);
  const importId = Number(imp.lastId);

  let n = 0;
  for (const sheet of parsed.sheets) {
    for (const it of sheet.items) {
      await execute(
        `INSERT INTO bom_items
           (project_id, material_description, moc, size_spec, sort_order, section, group_label,
            make, qty_text, purchase_status, pr_ref, po_ref, grn_ref, grn_qty_text,
            pending_qty_text, bqtc_ref, issued_ref, received_ref, remarks, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [params.id, it.material_description, it.moc, it.size_spec, n, it.section, it.group_label,
          it.make, it.qty_text, it.purchase_status, it.pr_ref, it.po_ref, it.grn_ref,
          it.grn_qty_text, it.pending_qty_text, it.bqtc_ref, it.issued_ref, it.received_ref,
          it.remarks, importId]);
      n++;
    }
  }

  await audit(replacing ? 'bom_replace' : 'bom_import', {
    actor: user.username,
    detail: JSON.stringify({
      project_id: Number(params.id), filename: file.name, revision,
      inserted: n, skipped: parsed.totalSkipped, previous_items: existing.n,
    }),
  });

  return NextResponse.json({ importId, revision, inserted: n, skipped: parsed.totalSkipped });
}
