import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

// Bulk-replace the mountings & fittings list for one document (QC-FOLDER-DESIGN.md §4.2). The list is
// a small, hand-maintained table, so the editor sends the whole set and we swap it wholesale — same
// child-then-parent explicit delete idiom the rest of QC uses (no reliance on FK cascade).
const FIELDS = ['description', 'size', 'moc', 'serial_numbers', 'make', 'qty'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const rows = Array.isArray(b.rows) ? b.rows : [];

  await execute('DELETE FROM qc_mountings WHERE document_id = ?', [params.id]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const vals = FIELDS.map(f => {
      const v = r[f];
      return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
    });
    // Skip a fully-blank row rather than persisting empty noise.
    if (vals.every(v => v == null)) continue;
    await execute(
      `INSERT INTO qc_mountings (document_id, ${FIELDS.join(', ')}, sort_order) VALUES (?, ${FIELDS.map(() => '?').join(', ')}, ?)`,
      [params.id, ...vals, i]);
  }

  await audit('qc_mountings_save', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), count: rows.length }),
  });
  return NextResponse.json({ ok: true });
}
