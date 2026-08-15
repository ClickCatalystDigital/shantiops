import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const REQUIRED = ['certificate_no', 'cast_no', 'material_spec', 'steel_maker'];
const FIELDS = [
  'certificate_no', 'cast_no', 'plate_no', 'material_spec', 'steel_maker',
  'size_t', 'size_w', 'size_l', 'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si',
  'ys', 'uts', 'elongation', 'bend_test',
];

// QC enters a Test Certificate — the bank record every statutory document's parts fetch from
// (QC-CHANGES.md §3). Exact-duplicate (cert + cast + plate) is rejected server-side even though the
// form already warns client-side, so the bank's key stays clean regardless of how it's reached.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const b = await req.json();
  for (const f of REQUIRED) {
    if (!String(b[f] || '').trim()) {
      return NextResponse.json({ error: `${f.replace('_', ' ')} is required` }, { status: 400 });
    }
  }

  const plateNo = b.plate_no?.trim() || null;
  const dupe = await queryOne(
    `SELECT id FROM test_certificates WHERE certificate_no = ? AND cast_no = ?
       AND (plate_no = ? OR (plate_no IS NULL AND ? IS NULL))`,
    [b.certificate_no.trim(), b.cast_no.trim(), plateNo, plateNo]);
  if (dupe) {
    return NextResponse.json(
      { error: 'Already in the bank — same certificate, cast and plate.', existingId: dupe.id },
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

  await audit('test_certificate_add', {
    actor: user.username,
    detail: JSON.stringify({ test_certificate_id: Number(res.lastId), certificate_no: b.certificate_no.trim() }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
