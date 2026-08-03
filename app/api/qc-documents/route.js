import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { SF_FORM_IVA_PARTS } from '@/lib/qc-template.mjs';

const HEADER_FIELDS = [
  'doc_id', 'makers_no', 'year_of_make', 'boiler_type', 'length_overall', 'internal_diameter',
  'design_pressure', 'hydro_test_pressure', 'heating_surface', 'evaporation_capacity', 'steam_temp',
  'drawing_no',
];

// New statutory document. V1 covers the SF series' Form IV A only (QC V1 plan §7) — the part list
// is auto-copied whole from SF_FORM_IVA_PARTS (client-confirmed, §8 assumption 1) rather than built
// by hand, so a fresh document is immediately a real, linkable table.
export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  if (!String(b.doc_id || '').trim()) return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const values = HEADER_FIELDS.map(f => {
    const v = b[f];
    return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
  });
  const res = await execute(
    `INSERT INTO qc_documents (project_id, series, ${HEADER_FIELDS.join(', ')}, created_by)
     VALUES (?, 'SF', ${HEADER_FIELDS.map(() => '?').join(', ')}, ?)`,
    [b.project_id, ...values, user.username]);
  const documentId = Number(res.lastId);

  for (let i = 0; i < SF_FORM_IVA_PARTS.length; i++) {
    const p = SF_FORM_IVA_PARTS[i];
    await execute(
      `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, p.part_no, p.part_name, p.size_t, p.size_w, p.size_l, p.qty, i]);
  }

  await audit('qc_document_add', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: documentId, project_id: b.project_id, doc_id: b.doc_id.trim() }),
  });
  return NextResponse.json({ id: documentId });
}
