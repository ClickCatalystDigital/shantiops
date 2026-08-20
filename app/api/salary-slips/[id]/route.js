import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSalarySlipDetail } from '@/lib/data';
import { postJournalEntry } from '@/lib/ledger-post';
import { salarySlipLines } from '@/lib/ledger.mjs';
import { todayISO } from '@/lib/date';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const detail = await getSalarySlipDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.payroll.slip_status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.status !== undefined) {
    if (!['draft', 'submitted', 'paid'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('status = ?'); args.push(b.status);
  }
  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 4 — marks whether this slip has been pushed to the
  // accounting system yet. Same route as the payroll status update above; HR already owns this UI.
  if (b.payroll_export_status !== undefined) {
    if (!['not_exported', 'exported', 'reconciled'].includes(b.payroll_export_status)) {
      return NextResponse.json({ error: 'Invalid payroll_export_status' }, { status: 400 });
    }
    fields.push('payroll_export_status = ?'); args.push(b.payroll_export_status);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE salary_slips SET ${fields.join(', ')} WHERE id = ?`, args);

  // ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — auto-post when a slip is marked paid (the actual
  // cash-out event; 'submitted' isn't, since nothing has left the bank yet).
  if (b.status === 'paid') {
    const slip = await getSalarySlipDetail(params.id);
    if (slip) {
      await postJournalEntry({
        company: slip.company,
        entryDate: todayISO(),
        sourceType: 'salary_slip',
        sourceId: slip.id,
        description: `Salary Slip — ${slip.employee_name} (${slip.period_month}/${slip.period_year})`,
        lines: salarySlipLines({
          grossEarnings: slip.gross_earnings, pfEmployee: slip.pf_employee, pfEmployer: slip.pf_employer,
          esiEmployee: slip.esi_employee, esiEmployer: slip.esi_employer, ptAmount: slip.pt_amount,
          tdsAmount: slip.tds_amount, netPay: slip.net_pay,
        }),
        createdBy: user.username,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
