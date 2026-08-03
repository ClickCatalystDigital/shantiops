import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';

const EDITABLE = [
  'doc_id', 'makers_no', 'year_of_make', 'boiler_type', 'length_overall', 'internal_diameter',
  'design_pressure', 'hydro_test_pressure', 'heating_surface', 'evaporation_capacity', 'steam_temp',
  'drawing_no',
];

// Editing the boiler-level header fields (the "edit" link on the Boiler details card) — the part
// table and its certificate links have their own endpoint (link-parts), not this one.
export async function PATCH(req, { params }) {
  const user = getSessionUser();
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
