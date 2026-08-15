import { NextResponse } from 'next/server';
import { getPackingDetail } from '@/lib/data';
import { getFreshSessionUser, isCustomer, canAccessDepartment, canAccessProject } from '@/lib/auth';
import { renderPackingPdf } from '@/lib/packing-pdf';

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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pdf = await renderPackingPdf(data.list, data.items);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.list.packing_no}.pdf"`,
    },
  });
}
