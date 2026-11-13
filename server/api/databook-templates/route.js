// Data Book templates (a customer's table of contents). A project's book copies a template's lines when started,
// so editing a template never changes a book already started.
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { forbidden } from '@/lib/quality-routes';
import { parseJson } from '@/lib/quality';
import { cleanLines } from '@/lib/databook.mjs';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const rows = await queryAll(`SELECT t.*, (SELECT COUNT(*) FROM databooks b WHERE b.template_name = t.name) AS books
    FROM databook_templates t ORDER BY t.is_default DESC, t.name`);
  return NextResponse.json(rows.map(r => ({ ...r, lines: parseJson(r.lines_json, []), lines_json: undefined })));
}

// Shared by POST and PUT: name, form number and lines checked the same way.
export function readTemplate(b) {
  const name = String(b.name ?? '').trim();
  const { lines, errors } = cleanLines(Array.isArray(b.lines) ? b.lines : []);
  if (!name) errors.unshift('Name is required');
  if (!lines.length) errors.push('Add at least one line');
  return { name, form_no: String(b.form_no ?? '').trim() || null, lines, errors };
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC') || (await requireAction(user, 'QC', 'qc.databook.template'));
  if (denied) return denied;
  const t = readTemplate(await req.json());
  if (t.errors.length) return NextResponse.json({ error: t.errors.join('; ') }, { status: 400 });
  try {
    const r = await execute('INSERT INTO databook_templates (name, form_no, lines_json) VALUES (?, ?, ?)', [t.name, t.form_no, JSON.stringify(t.lines)]);
    await audit('databook_template_created', { actor: user.username, detail: t.name });
    return NextResponse.json({ id: Number(r.lastId) }, { status: 201 });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return NextResponse.json({ error: 'A template with that name exists' }, { status: 409 });
    throw e;
  }
}
