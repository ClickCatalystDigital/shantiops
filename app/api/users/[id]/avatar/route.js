// A person's profile photo, for any signed-in staff member (nav, team lists). 404 when none.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const row = await queryOne('SELECT avatar_key FROM users WHERE id = ?', [Number(params.id)]);
  if (!row?.avatar_key) return NextResponse.json({ error: 'No photo' }, { status: 404 });
  try {
    const buf = await getObjectBuffer(row.avatar_key);
    const type = row.avatar_key.endsWith('.png') ? 'image/png' : row.avatar_key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    // The key changes on every upload, so the URL (?v=key) can be cached hard.
    return new NextResponse(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } });
  } catch { return NextResponse.json({ error: 'Photo unavailable' }, { status: 404 }); }
}
