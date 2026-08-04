import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { deleteObject } from '@/lib/r2';

const EDITABLE = [
  'certificate_no', 'cast_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test',
];

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [params.id]);
  if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE test_certificates SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  await audit('test_certificate_edit', {
    actor: user.username,
    detail: JSON.stringify({ test_certificate_id: Number(params.id), changed }),
  });
  return NextResponse.json({ ok: true });
}

// V2-CHANGES.md Group 1 — delete a certificate + its stored PDF, so R2 usage doesn't grow
// unboundedly (the client's own cost concern: storage will pass 10 GB with other things using it
// too). Blocked if any statutory-document part still cites this cert — deleting it would silently
// break that document's hard PDF gate (SYSTEM.md §5d), so it's a 409 naming the count, not a cascade.
export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const cert = await queryOne('SELECT id, pdf_key, certificate_no FROM test_certificates WHERE id = ?', [params.id]);
  if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const used = await queryOne(
    'SELECT COUNT(*) AS n FROM qc_document_parts WHERE test_certificate_id = ?', [params.id]);
  if (used.n > 0) {
    return NextResponse.json(
      { error: `Still used by ${used.n} statutory-document part${used.n === 1 ? '' : 's'} — unlink it there first` },
      { status: 409 });
  }

  if (cert.pdf_key) {
    try { await deleteObject(cert.pdf_key); }
    catch (e) { /* R2 not configured or object already gone — don't block deleting the DB row over it */ }
  }
  await execute('DELETE FROM test_certificates WHERE id = ?', [params.id]);

  await audit('test_certificate_delete', {
    actor: user.username,
    detail: JSON.stringify({ test_certificate_id: Number(params.id), certificate_no: cert.certificate_no }),
  });
  return NextResponse.json({ ok: true });
}
