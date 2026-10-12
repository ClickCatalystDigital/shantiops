// The signed-in person's profile photo: POST a file (PNG/JPEG/WebP, up to 2 MB), DELETE to remove.
// Stored in R2 under avatars/; served through /api/users/[id]/avatar.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { putObject, deleteObject } from '@/lib/r2';

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const file = (await req.formData()).get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Pick an image' }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'Use a PNG, JPEG or WebP image' }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'Image must be under 2 MB' }, { status: 400 });
  const key = `avatars/${user.id}-${Date.now()}.${ext}`;
  try { await putObject(key, Buffer.from(await file.arrayBuffer()), file.type); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  const old = await queryOne('SELECT avatar_key FROM users WHERE id = ?', [user.id]);
  await execute('UPDATE users SET avatar_key = ? WHERE id = ?', [key, user.id]);
  if (old?.avatar_key) deleteObject(old.avatar_key).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const old = await queryOne('SELECT avatar_key FROM users WHERE id = ?', [user.id]);
  await execute('UPDATE users SET avatar_key = NULL WHERE id = ?', [user.id]);
  if (old?.avatar_key) deleteObject(old.avatar_key).catch(() => {});
  return NextResponse.json({ ok: true });
}
