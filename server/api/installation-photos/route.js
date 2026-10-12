// Installation progress photos: multipart upload (compressed client-side), list per project.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { PHOTO_STAGES } from '@/lib/installation-photo-stages.mjs';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const pid = Number(sp.get('project_id'));
  return NextResponse.json(await queryAll(
    `SELECT ph.id, ph.project_id, ph.visit_id, ph.stage, ph.remarks, ph.taken_at, ph.taken_by, ph.created_at,
            p.project_no, p.customer_name, v.seq AS visit_seq, v.description AS visit_description
       FROM installation_photos ph JOIN projects p ON p.id = ph.project_id LEFT JOIN installation_visits v ON v.id = ph.visit_id
      ${pid ? 'WHERE ph.project_id = ?' : ''} ORDER BY COALESCE(ph.taken_at, ph.created_at) DESC, ph.id DESC LIMIT 300`, pid ? [pid] : []));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.photo.write');
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  const projectId = Number(form.get('project_id'));
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'No photo provided' }, { status: 400 });
  if (!projectId || !(await queryOne('SELECT id FROM projects WHERE id = ?', [projectId]))) return NextResponse.json({ error: 'Pick a project' }, { status: 400 });
  if (!String(file.type || '').startsWith('image/')) return NextResponse.json({ error: 'Only images are allowed' }, { status: 400 });
  const visitId = Number(form.get('visit_id')) || null;
  if (visitId && !(await queryOne('SELECT id FROM installation_visits WHERE id = ? AND project_id = ?', [visitId, projectId]))) {
    return NextResponse.json({ error: 'That visit does not belong to this project' }, { status: 400 });
  }
  const stage = String(form.get('stage') || '');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'Photo is too large (max 8 MB)' }, { status: 400 });

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `installation-photos/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try { await putObject(key, buffer, file.type); } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }

  const takenAt = String(form.get('taken_at') || '');
  const { lastId } = await execute(
    `INSERT INTO installation_photos (project_id, visit_id, stage, remarks, file_key, file_name, file_size, taken_at, taken_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, visitId, PHOTO_STAGES.includes(stage) ? stage : null, String(form.get('remarks') || '').trim() || null,
     key, file.name || null, buffer.length, /^\d{4}-\d{2}-\d{2}T/.test(takenAt) ? takenAt : new Date().toISOString(), user.username]
  );
  await audit('installation_photo_added', { actor: user.username, detail: `project ${projectId}` });
  return NextResponse.json({ id: Number(lastId) });
}
