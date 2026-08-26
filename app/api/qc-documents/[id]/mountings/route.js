import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Bulk-replace the mountings & fittings list for one document (QC-FOLDER-DESIGN.md §4.2). The list is
// a small, hand-maintained table, so the editor sends the whole set and we swap it wholesale — same
// child-then-parent explicit delete idiom the rest of QC uses (no reliance on FK cascade).
//
// bom_item_id MUST round-trip here — the editor's row objects already carry whatever sync-mountings
// set (lib/qc-bom-sync.js), and dropping it on every manual Save silently breaks two things: (1) the
// canonical-serial lookup (inventory_serials keyed on bom_item_id) falls back to nothing, and (2) the
// partial unique index (document_id, bom_item_id) WHERE bom_item_id IS NOT NULL stops recognizing the
// row as already-synced, so the next "Sync from BOM" inserts a duplicate instead of being ignored.
//
// That same unique index is why this now MUST run inside one transaction: two rows accidentally
// pointing at the same bom_item_id (the editor's per-row picker has nothing stopping a duplicate
// pick) would violate it partway through the insert loop — un-transacted, the DELETE above would
// already be committed, leaving the document with fewer mountings than before the failed save.
const FIELDS = ['description', 'size', 'moc', 'serial_numbers', 'make', 'qty', 'bom_item_id'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const rows = Array.isArray(b.rows) ? b.rows : [];

  await withTransaction(async tx => {
    await tx.execute({ sql: 'DELETE FROM qc_mountings WHERE document_id = ?', args: [params.id] });
    const seenBomItemIds = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vals = FIELDS.map(f => {
        const v = r[f];
        return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
      });
      const bomIdIdx = FIELDS.indexOf('bom_item_id');
      // A second row picking the same BOM item would violate the unique index — drop the link
      // instead of failing the whole save, same "surface, don't crash on" spirit as skipping blanks.
      if (vals[bomIdIdx] != null) {
        if (seenBomItemIds.has(vals[bomIdIdx])) vals[bomIdIdx] = null;
        else seenBomItemIds.add(vals[bomIdIdx]);
      }
      // Skip a fully-blank row rather than persisting empty noise.
      if (vals.every(v => v == null)) continue;
      await tx.execute({
        sql: `INSERT INTO qc_mountings (document_id, ${FIELDS.join(', ')}, sort_order) VALUES (?, ${FIELDS.map(() => '?').join(', ')}, ?)`,
        args: [params.id, ...vals, i],
      });
    }
  });

  await audit('qc_mountings_save', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), count: rows.length }),
  });
  return NextResponse.json({ ok: true });
}
