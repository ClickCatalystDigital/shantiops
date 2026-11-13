// Upload a PDF to one Data Book line (hashed), or remove one (?file_id=). Removing never touches a release:
// a released book keeps its own stored copy.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { storePdf } from '@/lib/pdf-upload';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';
import { getBook } from '@/lib/databook';

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.databook.write');
  if (denied) return denied;
  const book = await getBook(params.id);
  if (!book) return err('Start the Data Book first');
  const form = await req.formData();
  const key = String(form.get('line_key') || '');
  if (!book.lines.some(l => l.key === key)) return err('Unknown line');
  const file = form.get('file');
  const up = await storePdf(file, `databooks/${params.id}`);
  if (up.error) return err(up.error);
  const r = await execute('INSERT INTO databook_files (project_id, line_key, file_name, pdf_key, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [params.id, key, String(file.name || 'file.pdf').slice(0, 200), up.key, up.sha256, user.username]);
  await audit('databook_file_added', { actor: user.username, detail: JSON.stringify({ project_id: Number(params.id), line: key, file: file.name, sha256: up.sha256 }) });
  return NextResponse.json({ id: Number(r.lastId) }, { status: 201 });
}

export async function DELETE(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.databook.write');
  if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get('file_id'));
  const f = await queryOne('SELECT * FROM databook_files WHERE id = ? AND project_id = ?', [id, params.id]);
  if (!f) return err('Not found', 404);
  await execute('DELETE FROM databook_files WHERE id = ?', [f.id]);
  // ponytail: the R2 object is kept (a release may have used it and its manifest names the key).
  await audit('databook_file_removed', { actor: user.username, detail: JSON.stringify({ project_id: Number(params.id), line: f.line_key, file: f.file_name, key: f.pdf_key, sha256: f.sha256 }) });
  return NextResponse.json({ ok: true });
}
