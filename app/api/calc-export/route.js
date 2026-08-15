import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcState } from '@/lib/calc';
import { buildCalcWorkbook } from '@/lib/calc-export';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get('sheetId');
  if (!sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });

  const { variables, formulas, validations, tables } = await getCalcState(sheetId);
  const buf = buildCalcWorkbook({ variables, formulas, validations, tables });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="calc-sheets-export.xlsx"`,
    },
  });
}
