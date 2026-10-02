import { NextResponse } from 'next/server';
import { getPackingDetail } from '@/lib/data';
import { getFreshSessionUser, isCustomer, isInternal, canAccessDepartment, canAccessProject } from '@/lib/auth';
import { renderPackingPdf } from '@/lib/packing-pdf';
import { queryOne } from '@/lib/db';
import { modelCodeOf } from '@/lib/packing-forms.mjs';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const data = await getPackingDetail(params.id);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Same access rules as the packing detail page: Dispatch/PM can always get it; a customer only
  // for their own order once it's past draft.
  if (isCustomer(user)) {
    if (!canAccessProject(user, data.list.project_id) || data.list.status === 'draft') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (!canAccessDepartment(user, 'Dispatch')) {
    // Any other team can open it once it is past draft (the portal preview) — what the customer sees.
    if (!isInternal(user) || data.list.status === 'draft') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (data.list.layout === 'combined') {
    const p = await queryOne('SELECT * FROM projects WHERE id = ?', [data.list.project_id]);
    const m = p?.master_project_id ? await queryOne('SELECT * FROM projects WHERE id = ?', [p.master_project_id]) : null;
    if (p) data.list.model_code = modelCodeOf(p, m);
  }
  const only = new URL(req.url).searchParams.get('form');
  const pdf = await renderPackingPdf(data.list, data.items, { checklist: data.checklist, only });
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.list.packing_no}.pdf"`,
    },
  });
}
