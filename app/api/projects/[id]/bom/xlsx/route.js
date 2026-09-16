// app/api/projects/[id]/bom/xlsx/route.js — Project View redesign, Wave 2. The common, collapsed
// BOM row's "Download Excel" action. Same shape as the existing PDF route (bom/pdf/route.js), same
// auth, same data — just handed to lib/reports/excel.js's toWorkbook() instead of react-pdf, reusing
// bom-pdf.js's own COLS (label/accessor/align) unchanged. No new xlsx-writing code, no new
// dependency — the Report Engine's Excel writer already does this exact job.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getProjectBom } from '@/lib/data';
import { COLS } from '@/lib/bom-pdf';
import { toWorkbook } from '@/lib/reports/excel';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [params.id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const { bom } = await getProjectBom(params.id);

  const buf = toWorkbook({ table: { cols: COLS, rows: bom } });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BOM-${project.project_no}.xlsx"`,
    },
  });
}
