// app/api/company-settings/[id]/eway-bill-credentials/test/route.js — "Test Connection" button.
// Calls the same stub every real generation call would go through (lib/eway-bill.js), so it
// surfaces the honest "not wired yet" state today rather than faking a green check.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { generateEwayBill, loadCredentials } from '@/lib/eway-bill';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;

  const company = await queryOne('SELECT company FROM company_settings WHERE id = ?', [params.id]);
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const credentials = await loadCredentials(company.company);
    await generateEwayBill({ company: company.company, credentials, payload: { test: true } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
