import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { parsePaste } from '@/lib/qc-paste.mjs';

// Rows pasted from Excel into Form IV A parts or the mountings list (lib/qc-paste.mjs), added in one
// transaction after the existing rows. Same permission as adding one part/mounting. Pasted rows have
// no BOM link (a deployment without a BOM fills these by hand).
export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const target = b.target === 'mountings' ? 'mountings' : b.target === 'parts' ? 'parts' : null;
  if (!target) return NextResponse.json({ error: 'target must be parts or mountings' }, { status: 400 });
  const { rows, tooMany } = parsePaste(b.text, target);
  if (tooMany) return NextResponse.json({ error: 'At most 500 rows at a time' }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: 'No rows to add' }, { status: 400 });

  await withTransaction(async (tx) => {
    const table = target === 'parts' ? 'qc_document_parts' : 'qc_mountings';
    const max = (await tx.execute({ sql: `SELECT MAX(sort_order) AS n FROM ${table} WHERE document_id = ?`, args: [params.id] })).rows[0]?.n;
    let order = (max ?? -1) + 1;
    for (const r of rows) {
      if (target === 'parts') {
        await tx.execute({
          sql: `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [params.id, r.part_no, r.part_name, r.size_t, r.size_w, r.size_l, r.qty, order++],
        });
      } else {
        await tx.execute({
          sql: `INSERT INTO qc_mountings (document_id, description, size, moc, make, qty, serial_numbers, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [params.id, r.description, r.size, r.moc, r.make, r.qty, r.serial_numbers, order++],
        });
      }
    }
  });

  await audit('qc_paste_rows', { actor: user.username, detail: JSON.stringify({ qc_document_id: Number(params.id), target, rows: rows.length }) });
  return NextResponse.json({ added: rows.length });
}
