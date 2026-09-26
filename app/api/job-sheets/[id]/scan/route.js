// Scan of the paper Job Card (PDF or photo) — same mechanism as test-certificates/[id]/pdf:
// multipart POST -> R2, DELETE removes the object, GET proxies the bytes (no public bucket needed).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { putObject, getObjectBuffer, deleteObject } from '@/lib/r2';

const TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX = 15 * 1024 * 1024;

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  const sheet = await queryOne('SELECT id, scan_key FROM job_sheets WHERE id = ?', [params.id]);
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const file = (await req.formData()).get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'Upload a PDF, PNG, JPG or WebP' }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: 'File is over 15 MB' }, { status: 400 });
  const key = `job-sheets/${sheet.id}.${ext}`;
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    if (sheet.scan_key && sheet.scan_key !== key) await deleteObject(sheet.scan_key).catch(() => {});
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  await execute('UPDATE job_sheets SET scan_key = ?, scan_type = ? WHERE id = ?', [key, file.type, sheet.id]);
  await audit('job_sheet_scan_upload', { actor: user.username, detail: `sheet ${sheet.id}` });
  return NextResponse.json({ ok: true, scan_type: file.type });
}

export async function DELETE(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production') || await requireAction(user, 'Production', 'production.jobsheet.write');
  if (denied) return denied;
  const sheet = await queryOne('SELECT id, scan_key FROM job_sheets WHERE id = ?', [params.id]);
  if (!sheet?.scan_key) return NextResponse.json({ error: 'No scan on file' }, { status: 404 });
  await deleteObject(sheet.scan_key).catch(() => {});
  await execute('UPDATE job_sheets SET scan_key = NULL, scan_type = NULL WHERE id = ?', [sheet.id]);
  await audit('job_sheet_scan_remove', { actor: user.username, detail: `sheet ${sheet.id}` });
  return NextResponse.json({ ok: true });
}

export async function GET(_req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production') && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const sheet = await queryOne('SELECT scan_key, scan_type FROM job_sheets WHERE id = ?', [params.id]);
  if (!sheet?.scan_key) return NextResponse.json({ error: 'No scan on file' }, { status: 404 });
  try {
    return new NextResponse(await getObjectBuffer(sheet.scan_key), { headers: { 'Content-Type': sheet.scan_type || 'application/pdf' } });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
