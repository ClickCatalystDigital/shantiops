// A company's logo for documents. POST a PNG (the browser converts whatever was picked, see
// toLogoPng in lib/image-compress.js), DELETE to remove, GET to preview. Stored in R2 under
// company-logos/; documents get it through lib/company-profiles.js (companyProfile().logo).
import { NextResponse } from 'next/server';
import { queryOne, execute, refreshCompanies } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { putObject, deleteObject, getObjectBuffer } from '@/lib/r2';
import { audit } from '@/lib/usb';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024;

async function gate() {
  const user = await getFreshSessionUser();
  return { user, denied: requireDepartment(user, 'Accounts') || await requireAction(user, 'Accounts', 'accounts.company_settings.write') };
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const row = await queryOne('SELECT logo_key FROM company_settings WHERE id = ?', [params.id]);
  if (!row?.logo_key) return NextResponse.json({ error: 'No logo' }, { status: 404 });
  try {
    return new NextResponse(await getObjectBuffer(row.logo_key), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}

export async function POST(req, { params }) {
  const { user, denied } = await gate();
  if (denied) return denied;
  const row = await queryOne('SELECT id, company, logo_key FROM company_settings WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const file = (await req.formData()).get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Pick an image' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Logo must be under 1 MB' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the declared type: PNG signature + IHDR (width/height at bytes 16-23).
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return NextResponse.json({ error: 'Logo must be a PNG image' }, { status: 400 });
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (!w || !h || w > 4000 || h > 4000) return NextResponse.json({ error: 'Logo size is not valid' }, { status: 400 });
  const key = `company-logos/${row.id}-${Date.now()}.png`;
  try { await putObject(key, buf, 'image/png'); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  await execute('UPDATE company_settings SET logo_key = ?, logo_w = ?, logo_h = ? WHERE id = ?', [key, w, h, row.id]);
  if (row.logo_key) deleteObject(row.logo_key).catch(() => {});
  await refreshCompanies();
  await audit('company_logo_set', { actor: user.username, detail: `${row.company} ${w}x${h}` });
  return NextResponse.json({ ok: true, width: w, height: h });
}

export async function DELETE(req, { params }) {
  const { user, denied } = await gate();
  if (denied) return denied;
  const row = await queryOne('SELECT id, company, logo_key FROM company_settings WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  await execute('UPDATE company_settings SET logo_key = NULL, logo_w = NULL, logo_h = NULL WHERE id = ?', [row.id]);
  if (row.logo_key) deleteObject(row.logo_key).catch(() => {});
  await refreshCompanies();
  await audit('company_logo_removed', { actor: user.username, detail: row.company });
  return NextResponse.json({ ok: true });
}
