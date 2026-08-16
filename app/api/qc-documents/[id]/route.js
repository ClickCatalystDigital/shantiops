import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const EDITABLE = [
  'doc_id', 'makers_no', 'year_of_make', 'boiler_type', 'length_overall', 'internal_diameter',
  'design_pressure', 'hydro_test_pressure', 'heating_surface', 'evaporation_capacity', 'steam_temp',
  'drawing_no', 'company',
  // Full-folder fields (QC-FOLDER-DESIGN.md)
  'working_pressure', 'drawing_no_from', 'drawing_no_to', 'label_model_code',
  'submission_date', 'signer_name', 'recipient_name', 'recipient_address', 'manifest_extra',
];

// V2-CHANGES.md Group 2 — same two known companies as the create route.
const COMPANIES = ['Shanti Boilers', 'Shanti Techno Fab'];

// Editing the boiler-level header fields (the "edit" link on the Boiler details card) — the part
// table and its certificate links have their own endpoint (link-parts), not this one.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('doc_id') && !String(b.doc_id || '').trim()) {
    return NextResponse.json({ error: 'Document ID cannot be empty' }, { status: 400 });
  }
  if (keys.includes('company') && !COMPANIES.includes(b.company)) {
    return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE qc_documents SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);
  return NextResponse.json({ ok: true });
}

// Deletes the document and its part rows explicitly rather than relying on the schema's
// ON DELETE CASCADE — this app never turns SQLite foreign-key enforcement on for plain
// execute() calls, so the constraint alone wouldn't actually remove the child rows.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const doc = await queryOne('SELECT id, doc_id, project_id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_document_parts WHERE document_id = ?', [params.id]);
  await execute('DELETE FROM qc_documents WHERE id = ?', [params.id]);

  await audit('qc_document_delete', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), project_id: doc.project_id, doc_id: doc.doc_id }),
  });
  return NextResponse.json({ ok: true });
}
