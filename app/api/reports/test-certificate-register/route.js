// app/api/reports/test-certificate-register/route.js — QC report (plan §4). See lib/data.js's
// getTestCertificateRegisterLines.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getTestCertificateRegisterLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeTestCertificateRegister(company, { from, to } = {}) {
  const lines = await getTestCertificateRegisterLines(company, { from, to });
  return { lines, total: lines.length };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeTestCertificateRegister(company, { from, to }));
}
