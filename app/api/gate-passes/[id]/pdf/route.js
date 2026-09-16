// app/api/gate-passes/[id]/pdf/route.js — the printable Gate Pass slip, same shape as the BOM PDF
// route. Any status: a draft can be printed for review same as an issued one.
import { NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { renderGatePassPdf } from '@/lib/gate-pass-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const gp = await queryOne('SELECT * FROM gate_passes WHERE id = ?', [params.id]);
  if (!gp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  gp.items = await queryAll('SELECT * FROM gate_pass_items WHERE gate_pass_id = ? ORDER BY id', [params.id]);

  const pdf = await renderGatePassPdf({ gp });
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="GP-${gp.gp_no}.pdf"`,
    },
  });
}
