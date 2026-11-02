// GET ?company_id= — QuickBooks card state: switched on here?, can this user change it?, the
// connection (never tokens) and the company's own chart of accounts for the mapping table.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { qboConfig, connectionStatus, manageDenied, companyById } from '@/lib/quickbooks';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const cfg = qboConfig();
  if (!cfg) return NextResponse.json({ enabled: false });
  const co = await companyById(new URL(req.url).searchParams.get('company_id'));
  if (!co) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [conn, manage, accounts] = await Promise.all([
    connectionStatus(co.company).catch(err => ({ status: 'error', last_error: err.message })),
    manageDenied(user),
    queryAll('SELECT code, name, account_type FROM chart_of_accounts WHERE company = ? AND is_active = 1 ORDER BY code', [co.company]),
  ]);
  return NextResponse.json({
    enabled: true, environment: cfg.environment, demo: process.env.DEMO_MODE === '1',
    canManage: !manage, manageNote: manage, connection: conn, localAccounts: accounts,
  });
}
