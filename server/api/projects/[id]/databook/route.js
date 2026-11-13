// One project's Data Book: GET lines with live completeness and its releases; PUT starts it from a template,
// or marks a line not applicable (with a note) / required again.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { forbidden, err, qcOnly } from '@/lib/quality-routes';
import { getBook, bookStatus } from '@/lib/databook';
import { releaseProblems } from '@/lib/databook.mjs';
import { shippingBlockers, parseJson } from '@/lib/quality';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const book = await getBook(params.id);
  if (!book) return NextResponse.json({ book: null });
  const summary = await bookStatus(params.id, book);
  const files = await queryAll('SELECT id, line_key, file_name, sha256, uploaded_by, uploaded_at FROM databook_files WHERE project_id = ? ORDER BY id', [params.id]);
  const releases = await queryAll('SELECT id, revision, sha256, pages, released_by, released_at FROM databook_releases WHERE project_id = ? ORDER BY revision DESC', [params.id]);
  const problems = releaseProblems(summary, await shippingBlockers(Number(params.id)));
  return NextResponse.json({ book: { id: book.id, template_name: book.template_name, form_no: book.form_no }, ...summary, files, releases, problems });
}

export async function PUT(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.databook.write');
  if (denied) return denied;
  const b = await req.json();
  const project = await queryOne('SELECT id, project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return err('Not found', 404);
  const book = await getBook(project.id);
  if (b.template_id) {
    if (book) return err('This project already has a Data Book', 409);
    const t = await queryOne('SELECT * FROM databook_templates WHERE id = ?', [b.template_id]);
    if (!t) return err('Template not found', 404);
    await execute('INSERT INTO databooks (project_id, template_name, form_no, lines_json, prepared_by) VALUES (?, ?, ?, ?, ?)',
      [project.id, t.name, t.form_no, t.lines_json, user.username]);
    await audit('databook_started', { actor: user.username, detail: `${project.project_no} · ${t.name}` });
    return NextResponse.json({ ok: true });
  }
  if (!book) return err('Start the Data Book first');
  const lines = parseJson(book.lines_json, []);
  const line = lines.find(l => l.key === b.line_key);
  if (!line) return err('Unknown line');
  if (b.state === 'na') {
    const note = String(b.note || '').trim();
    if (!note) return err('Say why this line does not apply');
    Object.assign(line, { state: 'na', note });
  } else if (b.state === 'required') { delete line.state; delete line.note; }
  else return err('Unknown state');
  await execute('UPDATE databooks SET lines_json = ? WHERE id = ?', [JSON.stringify(lines), book.id]);
  await audit('databook_line', { actor: user.username, detail: `${project.project_no} · ${line.label} · ${b.state}${b.note ? ` · ${b.note}` : ''}` });
  return NextResponse.json({ ok: true });
}
