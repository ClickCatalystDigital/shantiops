// Service expense requests — list (mine / approvals / accounts) and create.
import { NextResponse } from 'next/server';
import { execute, nextNumber, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { listRequests, notifyRole } from '@/lib/service-expenses';
import { normalizeRequest, eligibleAdvances, tourSummary } from '@/lib/service-expense.mjs';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const scope = sp.get('scope') || 'mine';
  const kind = sp.get('kind');
  const kindSql = kind === 'cash' || kind === 'travel' ? ' AND kind = ?' : '';
  const kindParams = kindSql ? [kind] : [];
  if (scope === 'approvals') {
    if (!isPM(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listRequests({ where: `1=1${kindSql}`, params: kindParams }));
  }
  if (scope === 'accounts') {
    if (!canAccessDepartment(user, 'Accounts')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listRequests({ where: `status IN ('with_accounts','settled')${kindSql}`, params: kindParams }));
  }
  if (!canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await listRequests({ where: `requested_by = ?${kindSql}`, params: [user.username, ...kindParams] }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.expense.submit');
  if (denied) return denied;
  const b = await req.json();
  const kind = b.kind;
  const n = normalizeRequest(kind, b);
  if (n.error) return NextResponse.json({ error: n.error }, { status: 400 });

  const advanceIds = kind === 'travel' ? [...new Set((b.advance_ids || []).map(Number).filter(Boolean))] : [];
  const reqNo = await nextNumber(kind === 'cash' ? 'service_cash_no' : 'service_travel_no', kind === 'cash' ? 'CR' : 'TA');
  let id;
  try {
    id = await withTransaction(async tx => {
      let advance = 0;
      if (advanceIds.length) {
        // Re-checked here, not trusted from the form: approved, unused, and naming this customer.
        const rows = (await tx.execute({ sql: `SELECT id, req_no, status, amount, used_by, customers_json FROM service_expense_requests WHERE kind='cash' AND id IN (${advanceIds.map(() => '?').join(',')})`, args: advanceIds })).rows
          .map(r => ({ ...r, customers: JSON.parse(r.customers_json) }));
        const ok = eligibleAdvances(rows, n.customers[0].name);
        if (ok.length !== advanceIds.length) throw new Error('One of the selected cash requests is no longer available for this customer');
        advance = ok.reduce((s, r) => s + Number(r.amount), 0);
      }
      const ins = await tx.execute({
        sql: `INSERT INTO service_expense_requests (req_no, kind, requested_by, requester_name, form_date, amount, customers_json, data_json, advance_taken)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [reqNo, kind, user.username, user.display_name || user.username, n.data.date, n.amount, JSON.stringify(n.customers), JSON.stringify(n.data), advance],
      });
      const newId = Number(ins.lastInsertRowid);
      for (const aid of advanceIds) {
        const u = await tx.execute({ sql: 'UPDATE service_expense_requests SET used_by = ? WHERE id = ? AND used_by IS NULL', args: [newId, aid] });
        if (!u.rowsAffected) throw new Error('One of the selected cash requests was just used by another claim');
      }
      return newId;
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  await audit('service_expense_submitted', { actor: user.username, detail: `${reqNo} ${kind} ${n.amount}` });
  try {
    await notifyRole(['manager'], { kind: 'service_expense', title: `${reqNo} awaiting your approval`, body: `${user.display_name || user.username} · ${kind === 'cash' ? 'Cash request' : 'Travel allowance'} · ₹${n.amount}`, dedupe_key: `svcexp:${id}:manager` });
  } catch { /* best effort */ }
  return NextResponse.json({ id, req_no: reqNo });
}
