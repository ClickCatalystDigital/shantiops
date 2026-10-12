// Service expense requests — list (mine / approvals / accounts) and create.
import { NextResponse } from 'next/server';
import { execute, nextCounterValue, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { listRequests, notifyRole } from '@/lib/service-expenses';
import { normalizeRequest, eligibleAdvances, allocateAdvance, money } from '@/lib/service-expense.mjs';

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
  const n = normalizeRequest(kind, b, { keyPrefix: `service-expenses/${user.username}/` });
  if (n.error) return NextResponse.json({ error: n.error }, { status: 400 });

  const advanceIds = kind === 'travel' ? [...new Set((b.advance_ids || []).map(Number).filter(Boolean))] : [];
  const advance = kind === 'travel' ? money(b.advance) : 0; // the figure the user typed; cash requests only supply it
  // Cash requests are CR-0001…, travel claims EXP-00001… (separate running numbers).
  const reqNo = kind === 'cash'
    ? `CR-${String(await nextCounterValue('service_cash_no', 0)).padStart(4, '0')}`
    : `EXP-${String(await nextCounterValue('service_expense_no', 0)).padStart(5, '0')}`;
  let id;
  try {
    id = await withTransaction(async tx => {
      let links = [];
      if (advanceIds.length && advance > 0) {
        // Re-checked here, not trusted from the form: approved, money left, and the claimant's own or naming this customer.
        const inIds = advanceIds.map(() => '?').join(',');
        const rows = (await tx.execute({ sql: `SELECT id, req_no, status, amount, requested_by, customers_json FROM service_expense_requests WHERE kind='cash' AND id IN (${inIds})`, args: advanceIds })).rows;
        const used = (await tx.execute({ sql: `SELECT a.cash_id, a.amount FROM service_expense_advances a JOIN service_expense_requests t ON t.id = a.travel_id WHERE t.status != 'rejected' AND a.cash_id IN (${inIds})`, args: advanceIds })).rows;
        const ok = eligibleAdvances(rows.map(r => ({ ...r, customers: JSON.parse(r.customers_json), applied: used.filter(u => u.cash_id === r.id) })),
          { customerName: n.customers[0].name, username: user.username });
        if (ok.length !== advanceIds.length) throw new Error('One of the selected cash requests is no longer available (used up or not yours)');
        links = allocateAdvance(advance, advanceIds.map(i => ok.find(o => o.id === i))).links;
      }
      const ins = await tx.execute({
        sql: `INSERT INTO service_expense_requests (req_no, kind, requested_by, requester_name, form_date, amount, customers_json, data_json, advance_taken)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [reqNo, kind, user.username, user.display_name || user.username, n.data.date, n.amount, JSON.stringify(n.customers), JSON.stringify(n.data), advance],
      });
      const newId = Number(ins.lastInsertRowid);
      for (const l of links) await tx.execute({ sql: 'INSERT INTO service_expense_advances (cash_id, travel_id, amount) VALUES (?, ?, ?)', args: [l.cash_id, newId, l.amount] });
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
