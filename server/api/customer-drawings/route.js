import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, isCustomer, isInternal, canAccessProject } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { notifyDepartment } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { CUSTOMER_DRAWING_TYPES, CUSTOMER_DRAWING_MAX, resolveDrawingProjectId, getCustomerDrawings } from '@/lib/customer-drawings';

// GET ?project_id= — the customer (own order) or any internal user.
export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const pid = await resolveDrawingProjectId(Number(new URL(req.url).searchParams.get('project_id')));
  if (!pid) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (isCustomer(user) ? !canAccessProject(user, pid) : !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ uploads: await getCustomerDrawings(pid) });
}

// POST multipart: project_id, label, file — customers only.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isCustomer(user)) return NextResponse.json({ error: 'Customer access required' }, { status: 403 });
  const form = await req.formData();
  const pid = await resolveDrawingProjectId(Number(form.get('project_id')));
  if (!pid || !canAccessProject(user, pid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const label = String(form.get('label') || '').trim();
  if (!label) return NextResponse.json({ error: 'Add a label for this drawing' }, { status: 400 });
  if (label.length > 120) return NextResponse.json({ error: 'Label is too long (120 characters max)' }, { status: 400 });
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'Choose a file to upload' }, { status: 400 });
  const ext = CUSTOMER_DRAWING_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'Upload a PDF, PNG, JPG or WebP' }, { status: 400 });
  if (file.size > CUSTOMER_DRAWING_MAX) return NextResponse.json({ error: 'File is over 15 MB' }, { status: 400 });

  const key = `customer-drawings/${pid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try { await putObject(key, Buffer.from(await file.arrayBuffer()), file.type); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }

  const fileName = String(file.name || `drawing.${ext}`).slice(0, 200);
  const { lastId } = await execute(
    `INSERT INTO customer_drawing_uploads (project_id, label, file_name, file_size, mime, file_key, uploaded_by, uploaded_by_name)
     VALUES (?,?,?,?,?,?,?,?)`,
    [pid, label, fileName, file.size, file.type, key, user.username, user.display_name || user.username]);
  const id = Number(lastId);
  await audit('customer_drawing_uploaded', { actor: user.username, detail: `upload ${id} on project ${pid}: ${label}` });
  try {
    await notifyDepartment('Design', {
      kind: 'customer_drawing', project_id: pid, link: `/calc-drawings?project=${pid}`, dedupe_key: `customer_drawing:${id}`,
      title: 'Customer uploaded a drawing', body: label,
    });
  } catch { /* best effort — the upload itself is saved */ }
  return NextResponse.json({ ok: true, id });
}
