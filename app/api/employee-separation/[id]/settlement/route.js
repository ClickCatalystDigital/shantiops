// app/api/employee-separation/[id]/settlement/route.js — HR completion bundle. Full & Final
// settlement: one 'final' salary_slip covering pending pay to relieving_date + leave encashment −
// outstanding advances − loan foreclosure (lib/payroll.js generateSalarySlip handles all of it,
// including flipping the advance/loan statuses). Links employee_separation.settlement_slip_id.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { generateSalarySlip } from '@/lib/payroll';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const separation = await queryOne('SELECT * FROM employee_separation WHERE id = ?', [params.id]);
  if (!separation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (separation.settlement_slip_id) return NextResponse.json({ error: 'Settlement already generated' }, { status: 409 });
  if (!separation.relieving_date) return NextResponse.json({ error: 'Relieving date must be set before generating a settlement' }, { status: 400 });

  const periodYear = Number(separation.relieving_date.slice(0, 4));
  const periodMonth = Number(separation.relieving_date.slice(5, 7));

  try {
    const res = await generateSalarySlip(separation.employee_id, periodMonth, periodYear, {
      slipType: 'final', relievingDate: separation.relieving_date, createdBy: user.username,
    });
    await execute('UPDATE employee_separation SET settlement_slip_id = ? WHERE id = ?', [res.slipId, params.id]);
    await audit('final_settlement_generated', { actor: user.username, detail: `employee #${separation.employee_id}, slip #${res.slipId}` });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
