// Receipt upload for a travel claim: photo or PDF, stored under the user's own folder in R2 before the
// claim is submitted (the form then sends the returned { key, name, type, size } with the claim).
// ponytail: a file picked and then abandoned stays in R2 — add a sweep if it ever matters.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { ATTACH_TYPES } from '@/lib/service-expense.mjs';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const file = (await req.formData()).get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!ATTACH_TYPES.includes(file.type)) return NextResponse.json({ error: 'Only photos (JPG/PNG) and PDF files are allowed' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'File is too large (max 8 MB)' }, { status: 400 });
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const key = `service-expenses/${user.username}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try { await putObject(key, buffer, file.type); } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  return NextResponse.json({ key, name: String(file.name || `receipt.${ext}`).slice(0, 120), type: file.type, size: buffer.length });
}
