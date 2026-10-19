// Shop photos (SYSTEM.md §5fh). GET ?k=<key> serves one; POST (file + product_id | group_key) sets it;
// DELETE { product_id | group_key } removes it. Images only, under shop-images/ in R2.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { getObjectBuffer, putObject, deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';
import { canViewShop, canEditShop } from '@/lib/shop-access';
import { clearShopCache } from '@/lib/data';
import { GROUP_BY_KEY } from '@/lib/shop-catalog.mjs';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Real file signatures, not the browser's claim.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canViewShop(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const key = new URL(req.url).searchParams.get('k') || '';
  if (!/^shop-images\/[\w.-]+$/.test(key)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const buf = await getObjectBuffer(key);
    // The key changes on every upload, so it can be cached hard.
    return new NextResponse(buf, { headers: { 'Content-Type': sniff(buf) || 'application/octet-stream', 'Cache-Control': 'private, max-age=604800' } });
  } catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
}

async function target(productId, groupKey) {
  if (productId) {
    const p = await queryOne('SELECT id, product_name, image_key FROM sales_products WHERE id = ?', [Number(productId)]);
    return p && { kind: 'product', id: p.id, label: p.product_name, old: p.image_key };
  }
  if (groupKey && GROUP_BY_KEY.has(groupKey)) {
    const g = await queryOne('SELECT image_key FROM shop_group_images WHERE group_key = ?', [groupKey]);
    return { kind: 'group', id: groupKey, label: GROUP_BY_KEY.get(groupKey).label, old: g?.image_key || null };
  }
  return null;
}

async function save(t, key, username) {
  if (t.kind === 'product') await execute('UPDATE sales_products SET image_key = ? WHERE id = ?', [key, t.id]);
  else if (key) await execute(`INSERT INTO shop_group_images (group_key, image_key, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(group_key) DO UPDATE SET image_key = excluded.image_key, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`, [t.id, key, username]);
  else await execute('DELETE FROM shop_group_images WHERE group_key = ?', [t.id]);
  if (t.old?.startsWith('shop-images/') && t.old !== key) deleteObject(t.old).catch(() => {});
  clearShopCache();
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canEditShop(user)) return NextResponse.json({ error: 'Only Sales and managers can change shop photos' }, { status: 403 });
  const form = await req.formData();
  const t = await target(form.get('product_id'), form.get('group_key'));
  if (!t) return NextResponse.json({ error: 'Unknown product or group' }, { status: 400 });
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Pick an image' }, { status: 400 });
  if (file.size > 1024 * 1024) return NextResponse.json({ error: 'Image must be under 1 MB' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type) return NextResponse.json({ error: 'Use a JPEG, PNG or WebP image' }, { status: 400 });
  const key = `shop-images/${t.kind}-${String(t.id).replace(/[^\w-]/g, '')}-${Date.now()}.${TYPES[type]}`;
  try { await putObject(key, buf, type); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  await save(t, key, user.username);
  await audit('shop_photo_set', { actor: user.username, detail: `${t.kind} ${t.label}` });
  return NextResponse.json({ ok: true, image_key: key });
}

export async function DELETE(req) {
  const user = await getFreshSessionUser();
  if (!canEditShop(user)) return NextResponse.json({ error: 'Only Sales and managers can change shop photos' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const t = await target(b.product_id, b.group_key);
  if (!t) return NextResponse.json({ error: 'Unknown product or group' }, { status: 400 });
  await save(t, null, user.username);
  await audit('shop_photo_removed', { actor: user.username, detail: `${t.kind} ${t.label}` });
  return NextResponse.json({ ok: true });
}
