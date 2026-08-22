// app/api/reports/drawing-register/route.js — Design management report: every drawing's
// status/assignee/due date across projects. See lib/data.js's getDrawingRegisterLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getDrawingRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeDrawingRegister(company, { from, to } = {}) {
  const lines = await getDrawingRegisterLines(company, { from, to });
  return {
    lines,
    total: lines.length,
    overdue: lines.filter((l) => l.overdue).length,
    approved: lines.filter((l) => ['approved', 'as_built'].includes(l.status)).length,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Design');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeDrawingRegister(company, { from, to }));
}
