// app/api/projects/[id]/delivery-lots/xlsx/route.js — Project View redesign, Decision K, item 2
// ("Expected delivery lots from the existing Receive-a-Delivery workflow," downloadable as Excel).
// Reuses attachDeliveryLotDates() unchanged — the exact function Stores' own "Receive a Delivery"
// tab already uses to compute nearest_expected_delivery/all_expected_dates per line, never a second
// calculation.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectBom, attachDeliveryLotDates } from '@/lib/data';
import { toWorkbook } from '@/lib/reports/excel';

export const runtime = 'nodejs';

const COLS = [
  ['#', 4, (it, i) => i + 1],
  ['Description', 30, (it) => it.material_description],
  ['MOC', 14, (it) => it.moc || '—'],
  ['Qty', 12, (it) => it.qty_text || '—'],
  ['Status', 12, (it) => it.purchase_status],
  ['Nearest Expected Date', 16, (it) => it.nearest_expected_delivery || '—'],
];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const { bom } = await getProjectBom(params.id);
  const open = bom.filter(b => !['Received', 'In-Stock', 'Cancelled'].includes(b.purchase_status));
  const withDates = await attachDeliveryLotDates(open);
  const scheduled = withDates.filter(it => it.nearest_expected_delivery);

  const buf = toWorkbook({ table: { cols: COLS, rows: scheduled } });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Delivery-Lots-${project.project_no}.xlsx"`,
    },
  });
}
