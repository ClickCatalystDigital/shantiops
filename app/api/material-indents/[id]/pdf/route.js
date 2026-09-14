// app/api/material-indents/[id]/pdf/route.js — the physical handoff document (plan §11). Always
// rendered fresh from current DB state (getMaterialIndentDetail), never a stored snapshot — a
// download taken before and after a partial release reflects whatever is true at request time.
// Any internal user, matching the JSON detail route's own access level (both Production, who
// raised it, and Stores, who processes it, need to reach this).
import { NextResponse } from 'next/server';
import { getMaterialIndentDetail } from '@/lib/data';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { renderMaterialIndentPdf } from '@/lib/material-indent-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const detail = await getMaterialIndentDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderMaterialIndentPdf(detail.indent, detail.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${detail.indent.indent_no.replace(/\//g, '-')}.pdf"`,
    },
  });
}
