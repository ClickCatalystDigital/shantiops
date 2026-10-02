// app/api/sales-library/route.js — Sales Library: mailers, presentations, price lists (SYSTEM.md §5dr).
// Everyone in Sales can read and add; files are stored in R2 like the other attachments (lib/r2.js).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const CATEGORIES = ['mailer', 'presentation', 'price_list', 'other'];
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT id, category, title, file_name, file_size, uploaded_by, uploaded_at FROM sales_library_files ORDER BY uploaded_at DESC, id DESC'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 25 MB' }, { status: 400 });
  const category = CATEGORIES.includes(form.get('category')) ? form.get('category') : 'other';
  const title = String(form.get('title') || file.name).trim().slice(0, 200) || file.name;
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `sales-library/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  let url;
  try { url = await putObject(key, buffer, file.type || 'application/octet-stream'); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  const { lastId } = await execute(
    'INSERT INTO sales_library_files (category, title, file_name, file_size, file_key, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [category, title, file.name, buffer.length, key, url, user.username]);
  await audit('sales_library_added', { actor: user.username, detail: JSON.stringify({ id: Number(lastId), title, category }) });
  return NextResponse.json({ id: Number(lastId) });
}
