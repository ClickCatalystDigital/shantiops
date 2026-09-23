// app/api/work-orders/[id]/job-card-pdf/route.js — printed Job Card traveler, same shape as
// app/api/projects/[id]/bom/pdf/route.js.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getJobCardTravelerData } from '@/lib/data';
import { renderJobCardPdf } from '@/lib/job-card-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const data = await getJobCardTravelerData(params.id);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderJobCardPdf(data);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="JobCard-${data.workOrder.wo_no}.pdf"`,
    },
  });
}
