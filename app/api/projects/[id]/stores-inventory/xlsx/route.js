// app/api/projects/[id]/stores-inventory/xlsx/route.js — Project View redesign, Decision K, item 1
// ("Total project inventory," downloadable as Excel). Same shape as the BOM Excel route.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectInventoryItems } from '@/lib/data';
import { toWorkbook } from '@/lib/reports/excel';

export const runtime = 'nodejs';

const COLS = [
  ['#', 4, (it, i) => i + 1],
  ['Description', 30, (it) => it.material_description],
  ['MOC', 14, (it) => it.moc || '—'],
  ['Size / Spec', 18, (it) => it.size_spec || '—'],
  ['Qty', 12, (it) => it.qty_text || '—'],
  ['Status', 12, (it) => it.purchase_status],
  ['GRN Ref', 14, (it) => it.grn_ref || '—'],
];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const items = await getProjectInventoryItems(params.id);

  const buf = toWorkbook({ table: { cols: COLS, rows: items } });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Inventory-${project.project_no}.xlsx"`,
    },
  });
}
