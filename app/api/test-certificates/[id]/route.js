// app/api/test-certificates/[id]/route.js

import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { deleteObject } from '@/lib/r2';

const EDITABLE = [
  'certificate_no', 'cast_no', 'heat_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test',
  'steel_making_process', 'heat_treatment',
];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.certificate.write');
  if (actionDenied) return actionDenied;

  const cert = await queryOne('SELECT id FROM test_certificates WHERE id = ?', [params.id]);
  if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  const hasProjectIds = Array.isArray(b.project_ids);
  if (!keys.length && !hasProjectIds) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  // Reconcile project links (many-to-many). `project_ids` is the full desired set. Additions are
  // free; a removal is blocked (409) if that project's statutory-document parts still cite this cert
  // — removing it would leave those parts pointing at a cert no longer in their project.
  if (hasProjectIds) {
    const want = new Set(b.project_ids.map(Number).filter(Boolean));
    const have = new Set((await queryAll('SELECT project_id FROM certificate_projects WHERE certificate_id = ?', [params.id])).map(r => r.project_id));
    const toAdd = [...want].filter(p => !have.has(p));
    const toRemove = [...have].filter(p => !want.has(p));
    for (const pid of toRemove) {
      const used = await queryOne(
        `SELECT COUNT(*) AS n FROM qc_document_parts p JOIN qc_documents d ON d.id = p.document_id
          WHERE p.test_certificate_id = ? AND d.project_id = ?`, [params.id, pid]);
      if (used.n > 0) {
        return NextResponse.json(
          { error: `Used by ${used.n} document part${used.n === 1 ? '' : 's'} in that project — unlink it there before removing the project` },
          { status: 409 });
      }
    }
    for (const pid of toAdd) {
      const project = await queryOne('SELECT id FROM projects WHERE id = ?', [pid]);
      if (project) await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)', [params.id, pid]);
    }
    for (const pid of toRemove) await execute('DELETE FROM certificate_projects WHERE certificate_id = ? AND project_id = ?', [params.id, pid]);
  }

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  if (Object.keys(changed).length) {
    await execute(
      `UPDATE test_certificates SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(changed), params.id]);
  }

  await audit('test_certificate_edit', {
    actor: user.username,
    detail: JSON.stringify({ test_certificate_id: Number(params.id), changed, project_ids: hasProjectIds ? b.project_ids : undefined }),
  });
  return NextResponse.json({ ok: true });
}

// V2-CHANGES.md Group 1 — delete a certificate + its stored PDF, so R2 usage doesn't grow
// unboundedly (the client's own cost concern: storage will pass 10 GB with other things using it
// too). Blocked if any statutory-document part still cites this cert — deleting it would silently
// break that document's hard PDF gate (SYSTEM.md §5d), so it's a 409 naming the count, not a cascade.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.certificate.delete');
  if (actionDenied) return actionDenied;

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
