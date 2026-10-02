import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isCustomer, isInternal, canAccessProject } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';

// Proxied read-back (no public bucket needed). Images/PDFs open inline; ?download=1 forces a save.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const row = await queryOne('SELECT project_id, file_key, file_name, mime FROM customer_drawing_uploads WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isCustomer(user) ? !canAccessProject(user, row.project_id) : !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const buffer = await getObjectBuffer(row.file_key);
    const safe = row.file_name.replace(/[^\w.\- ]+/g, '_');
    const disp = new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline';
    return new NextResponse(buffer, { headers: {
      'Content-Type': row.mime || 'application/octet-stream',
      'Content-Disposition': `${disp}; filename="${safe}"`,
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
