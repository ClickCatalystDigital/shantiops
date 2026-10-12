import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { runDepreciation } from '@/lib/fixed-assets';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { todayISO } from '@/lib/date';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.fixed_asset.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  if (!b.period_year || !b.period_month) {
    return NextResponse.json({ error: 'period_year and period_month are required' }, { status: 400 });
  }
  try {
    const result = await runDepreciation({
      company, periodYear: Number(b.period_year), periodMonth: Number(b.period_month),
      runDate: b.run_date || todayISO(), createdBy: user.username,
    });
    if (!result.alreadyRan) {
      await audit('depreciation_run', { actor: user.username, detail: `${company} ${b.period_year}-${b.period_month}: ${result.total} across ${result.assetCount} asset(s)` });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
