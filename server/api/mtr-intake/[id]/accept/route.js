// A person reviewed the lines: each becomes one test_certificates row (all sharing the uploaded PDF and its
// hash), in one transaction. Same duplicate rule as a certificate added by hand: certificate + heat + plate.
import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';
import { lineToCertificate, lineProblems } from '@/lib/mtr-extract.mjs';

const COLS = ['certificate_no', 'cast_no', 'heat_no', 'plate_no', 'material_spec', 'steel_maker', 'certificate_date',
  'chem_c', 'chem_mn', 'chem_p', 'chem_s', 'chem_si', 'ys', 'uts', 'elongation'];

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.certificate.write');
  if (denied) return denied;
  const b = await req.json();
  const m = await queryOne('SELECT id, status, pdf_key, sha256, file_name FROM mtr_intake WHERE id = ?', [params.id]);
  if (!m) return err('Not found', 404);
  if (!m.pdf_key) return err('A duplicate file has nothing to accept', 409);
  if (['accepted', 'rejected'].includes(m.status)) return err(`This file is already ${m.status}`, 409);
  const header = b.header || {};
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return err('No lines to save');
  for (const [i, l] of lines.entries()) {
    const p = lineProblems(header, l);
    if (p.length) return err(`Line ${i + 1} needs: ${p.join(', ')}`);
  }
  const certs = lines.map(l => lineToCertificate(header, l));
  const projectIds = [...new Set((b.project_ids || []).map(Number).filter(Boolean))];
  try {
    const ids = await withTransaction(async tx => {
      const out = [];
      for (const [i, c] of certs.entries()) {
        const dupe = (await tx.execute({ sql: `SELECT id FROM test_certificates WHERE certificate_no = ? AND cast_no = ?
          AND (plate_no = ? OR (plate_no IS NULL AND ? IS NULL))`, args: [c.certificate_no, c.cast_no, c.plate_no, c.plate_no] })).rows[0];
        if (dupe) throw Object.assign(new Error(`Line ${i + 1} (${c.certificate_no} heat ${c.cast_no}${c.plate_no ? ` plate ${c.plate_no}` : ''}) is already in the bank`), { status: 409 });
        const r = await tx.execute({ sql: `INSERT INTO test_certificates (${COLS.join(', ')}, pdf_key, pdf_sha256, intake_id, created_by)
          VALUES (${COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`, args: [...COLS.map(k => c[k] ?? null), m.pdf_key, m.sha256, m.id, user.username] });
        const id = Number(r.lastInsertRowid);
        for (const pid of projectIds) await tx.execute({ sql: 'INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) SELECT ?, id FROM projects WHERE id = ?', args: [id, pid] });
        out.push(id);
      }
      await tx.execute({ sql: "UPDATE mtr_intake SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", args: [user.username, m.id] });
      return out;
    });
    await audit('mtr_accepted', { actor: user.username, detail: JSON.stringify({ id: m.id, file: m.file_name, certificates: ids, heats: certs.map(c => c.cast_no) }) });
    return NextResponse.json({ ok: true, certificate_ids: ids });
  } catch (e) {
    if (e.status) return err(e.message, e.status);
    throw e;
  }
}
