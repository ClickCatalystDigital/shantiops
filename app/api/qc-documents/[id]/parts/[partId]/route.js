import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

// V2-CHANGES.md Group 2 — remove a part that's an exception (not applicable to this boiler, entered
// in error, etc.). No linkage guard needed here — unlike deleting a certificate (which could break
// other documents), removing a part only affects this one document's own list, and removing an
// unlinked part can only ever shrink what Preview PDF's hard gate requires, never break it.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  // Scoped to this document — a stray/forged part id from another document must not be deletable
  // through this route, same trust-boundary reasoning as link-parts' own ownership check.
  const part = await queryOne(
    'SELECT id, part_name FROM qc_document_parts WHERE id = ? AND document_id = ?', [params.partId, params.id]);
  if (!part) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_document_parts WHERE id = ?', [params.partId]);

  await audit('qc_document_part_remove', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), part_id: Number(params.partId), part_name: part.part_name }),
  });
  return NextResponse.json({ ok: true });
}
