// app/api/work-orders/[id]/costing-pdf/route.js — REPORT-ENGINE-PLAN.md §10 Phase 2. Same
// Production gate as the existing JSON route (app/api/work-orders/[id]/costing/route.js).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getWorkOrderCosting } from '@/lib/data';
import { renderWorkOrderCostingPdf } from '@/lib/work-order-costing-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;

  const wo = await queryOne(
    `SELECT wo.wo_no, p.company FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id WHERE wo.id = ?`,
    [params.id]
  );
  if (!wo) return NextResponse.json({ error: 'Work Order not found' }, { status: 404 });
  const costing = await getWorkOrderCosting(params.id);
  if (!costing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await renderWorkOrderCostingPdf(wo, costing, wo.company);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Costing-${wo.wo_no}.pdf"`,
    },
  });
}
