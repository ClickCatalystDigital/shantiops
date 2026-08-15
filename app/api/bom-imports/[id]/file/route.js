import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';

// Download the original .xlsx exactly as it was imported — the revision record for audits and
// "the spreadsheet said X" disputes. Internal roles only (customers never see the BOM).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const row = await queryOne(
    'SELECT filename, file FROM bom_imports WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // libsql returns blobs as ArrayBuffer (or Uint8Array depending on transport) — normalize.
  const bytes = row.file instanceof Uint8Array ? row.file : new Uint8Array(row.file);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${row.filename.replace(/[^\w.\- ]/g, '_')}"`,
    },
  });
}
