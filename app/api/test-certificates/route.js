// app/api/test-certificates/route.js

import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const REQUIRED = ['certificate_no', 'cast_no', 'material_spec', 'steel_maker'];
const FIELDS = [
  'certificate_no', 'cast_no', 'heat_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test',
  'steel_making_process', 'heat_treatment',   // Form III A extras (QC-FOLDER-DESIGN.md)
];

// QC enters a Test Certificate — one physical cert (cert + cast + plate), globally unique in the bank
// (a cert is a real material, entered once). It may be linked to any number of projects now or later
// via certificate_projects; `project_ids` on create is optional (a cert can be uploaded unassigned).
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.certificate.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  for (const f of REQUIRED) {
    if (!String(b[f] || '').trim()) {
      return NextResponse.json({ error: `${f.replace('_', ' ')} is required` }, { status: 400 });
    }
  }

  const plateNo = b.plate_no?.trim() || null;
  // Global dupe: one physical cert is entered once, then linked to many projects.
  const dupe = await queryOne(
    `SELECT id FROM test_certificates WHERE certificate_no = ? AND cast_no = ?
       AND (plate_no = ? OR (plate_no IS NULL AND ? IS NULL))`,
    [b.certificate_no.trim(), b.cast_no.trim(), plateNo, plateNo]);
  if (dupe) {
    return NextResponse.json(
      { error: 'Already in the bank — same certificate, cast and plate. Add its project from that row instead.', existingId: dupe.id },
      { status: 409 });
  }

  const values = FIELDS.map(f => {
    if (f === 'plate_no') return plateNo;
    const v = b[f];
    return typeof v === 'string' ? (v.trim() || null) : (v ?? null);
  });
  const res = await execute(
    `INSERT INTO test_certificates (${FIELDS.join(', ')}, created_by)
     VALUES (${FIELDS.map(() => '?').join(', ')}, ?)`,
    [...values, user.username]);
  const certId = Number(res.lastId);

  // Optional initial project links. Validate each exists; ignore duplicates (idempotent).
  const projectIds = Array.isArray(b.project_ids) ? [...new Set(b.project_ids.map(Number).filter(Boolean))] : [];
  for (const pid of projectIds) {
    const project = await queryOne('SELECT id FROM projects WHERE id = ?', [pid]);
    if (!project) continue;
    await execute('INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)', [certId, pid]);
  }

  await audit('test_certificate_add', {
    actor: user.username,
    detail: JSON.stringify({ test_certificate_id: certId, certificate_no: b.certificate_no.trim(), project_ids: projectIds }),
  });
  return NextResponse.json({ id: certId });
}
