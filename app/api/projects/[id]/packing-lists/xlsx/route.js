// app/api/projects/[id]/packing-lists/xlsx/route.js — Project View redesign, Decision N. The
// Packing & Dispatch card's downloadable Excel packing list — this project's own packing_lists
// rows (every status, matching PackingPanel's old "every status including draft" behavior).
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectPackingLists } from '@/lib/data';
import { toWorkbook } from '@/lib/reports/excel';

export const runtime = 'nodejs';

const COLS = [
  ['#', 4, (it, i) => i + 1],
  ['Packing No.', 16, (it) => it.packing_no],
  ['Status', 12, (it) => it.status],
  ['Items', 8, (it) => it.item_count, 'right'],
  ['Vehicle No.', 14, (it) => it.vehicle_no || '—'],
  ['Dispatched', 16, (it) => it.dispatched_at || '—'],
];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const lists = await getProjectPackingLists(params.id);

  const buf = toWorkbook({ table: { cols: COLS, rows: lists } });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Packing-Lists-${project.project_no}.xlsx"`,
    },
  });
}
