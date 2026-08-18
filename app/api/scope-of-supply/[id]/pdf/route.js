import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getScopeOfSupply } from '@/lib/data';
import { renderSosPdf } from '@/lib/sos-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const header = await queryOne('SELECT project_id FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!header) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const docs = await getScopeOfSupply(header.project_id);
  const sos = docs.find(d => d.id === Number(params.id));
  if (!sos) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderSosPdf(sos);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${sos.title.replace(/[^a-z0-9]+/gi, '-')}.pdf"`,
    },
  });
}
