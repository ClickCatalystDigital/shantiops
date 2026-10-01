// Streams the photo through the app (auth-gated) so it works whether or not the bucket has a public URL.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const row = await queryOne('SELECT file_key FROM installation_photos WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const buf = await getObjectBuffer(row.file_key);
    return new NextResponse(buf, { headers: { 'Content-Type': row.file_key.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
