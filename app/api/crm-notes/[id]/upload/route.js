// app/api/crm-notes/[id]/upload/route.js — Diary's "Attach Files" (Phase 1). Same shape as
// calc-drawings' own upload route: formData -> arrayBuffer -> Buffer -> putObject -> store the R2
// key. Best-effort: an unconfigured bucket 502s this route without touching anything already saved.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const note = await queryOne('SELECT id FROM crm_notes WHERE id = ?', [params.id]);
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `crm-notes/${params.id}/${Date.now()}-${file.name}`;

  let url;
  try {
    url = await putObject(key, buffer, file.type || 'application/octet-stream');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const { lastId } = await execute(
    `INSERT INTO crm_note_files (note_id, file_name, file_size, file_key, file_url, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, file.name, buffer.length, key, url, user.username]
  );
  await audit('crm_note_file_uploaded', { actor: user.username, detail: `note ${params.id}: ${file.name}` });
  return NextResponse.json({ id: Number(lastId), fileUrl: url });
}
