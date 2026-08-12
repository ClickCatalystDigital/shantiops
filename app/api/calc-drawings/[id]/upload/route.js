import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, addDrawingFile } from '@/lib/calc';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

// CALC-CHANGES2.md §B — same shape as test-certificates' PDF upload: formData -> arrayBuffer ->
// Buffer -> putObject, then store the R2 key. Best-effort: an unconfigured bucket (missing env
// vars) 502s this route without touching anything already saved.
export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `calc-drawings/${params.id}/${Date.now()}-${file.name}`;

  let url;
  try {
    url = await putObject(key, buffer, file.type || 'application/octet-stream');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const id = await addDrawingFile({
    drawingId: params.id, fileName: file.name, fileSize: buffer.length, fileKey: key, fileUrl: url, uploadedBy: user.username,
  });
  await audit('calc_drawing_file_uploaded', { actor: user.username, detail: `drawing ${params.id}: ${file.name}` });
  return NextResponse.json({ id, fileUrl: url });
}
