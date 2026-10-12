// app/api/sales-targets/route.js — Sales CRM expansion Phase 0e. A PM/Sales-Head sets a numeric
// target per Branch + A/C Manager + period ('YYYY-MM'), so the Prospect Summary Report's
// Targets/T/A columns are real numbers, not stubs. sales.target.write is seeded Head-only in
// migrate() (INSERT OR IGNORE ... requires_head=1) — letting any team member set/edit their own
// target would defeat the report's whole point.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const period = new URL(req.url).searchParams.get('period');
  if (period) {
    return NextResponse.json(await queryAll('SELECT * FROM sales_targets WHERE period = ? ORDER BY branch_id, account_manager', [period]));
  }
  return NextResponse.json(await queryAll('SELECT * FROM sales_targets ORDER BY period DESC, branch_id, account_manager'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.target.write');
  if (denied) return denied;

  const b = await req.json();
  const period = String(b.period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "Period must be 'YYYY-MM'" }, { status: 400 });
  const targetAmount = Number(b.target_amount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0) {
    return NextResponse.json({ error: 'Target amount must be a non-negative number' }, { status: 400 });
  }

  // Upsert — the natural gesture for "set this month's target" is repeatable without erroring on
  // the UNIQUE(branch_id, account_manager, period) constraint. Same shape as lib/db.js's own
  // setAppSetting() — execute()'s lastId isn't reliable on the DO UPDATE branch of an upsert, so
  // this doesn't try to read one back; the caller re-fetches via GET, same as every other list here.
  await execute(
    `INSERT INTO sales_targets (branch_id, account_manager, period, target_amount, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, account_manager, period)
     DO UPDATE SET target_amount = excluded.target_amount, updated_at = CURRENT_TIMESTAMP`,
    [b.branch_id || null, b.account_manager || null, period, targetAmount, user.username]
  );
  await audit('sales_target_set', { actor: user.username, detail: `${period} — ${targetAmount}` });
  return NextResponse.json({ ok: true });
}
