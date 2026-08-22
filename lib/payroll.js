// lib/payroll.js — HR completion bundle (statutory Payroll + Full & Final settlement). Mirrors
// lib/hr.js's shape: pure-ish calculators plus one persistence entrypoint per lifecycle action
// (createEmployeeWithOnboarding's precedent). Every number computed here is stored as a plain fact
// — no ledger, no journal entry, ever (V3_CHANGES.md HARD BOUNDARY, intentionally reopened for
// computation-and-storage only; a future accounting sync reads the ACCOUNTING INTEGRATION POINT
// columns on salary_slips/expense_claims).
import { queryAll, queryOne, execute } from './db';
import { countWorkingDays, getShiftForDate } from './hr';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// India's financial year runs Apr–Mar, e.g. getFinancialYear(8, 2026) -> "2026-27".
export function getFinancialYear(month, year) {
  return month >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

function monthsBetweenInclusive(m1, y1, m2, y2) {
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

// How many payroll periods this employee HAS in the given FY (accounting for a mid-year join) —
// the denominator YTD-accurate TDS annualizes by. Purely a calendar fact (join date to FY end),
// unaffected by whether payroll has actually been run for every one of those months yet.
function periodsTotalForFy(dateOfJoining, financialYear) {
  const fyStart = Number(financialYear.slice(0, 4));
  let joinMonth = 4, joinYear = fyStart;
  if (dateOfJoining) {
    const jy = Number(dateOfJoining.slice(0, 4));
    const jm = Number(dateOfJoining.slice(5, 7));
    const joinedBeforeFy = jy < fyStart || (jy === fyStart && jm < 4);
    if (!joinedBeforeFy) { joinMonth = jm; joinYear = jy; }
  }
  return Math.max(1, monthsBetweenInclusive(joinMonth, joinYear, 3, fyStart + 1));
}

// Loss-of-Pay proration. Unmarked attendance days are treated as present (paid) by default — the
// realistic default for salaried staff who aren't punched every single day; only an explicit
// 'absent' mark or a 'leave' day whose leave_type is unpaid reduces payment_days.
export async function computePaymentDays(employeeId, fromDate, toDate) {
  const workingDays = await countWorkingDays(fromDate, toDate);
  const unpaid = await queryOne(
    `SELECT COUNT(*) AS n FROM attendance_days ad
       LEFT JOIN leave_requests lr ON lr.id = ad.leave_request_id
       LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE ad.employee_id = ? AND ad.date BETWEEN ? AND ?
        AND (ad.status = 'absent' OR (ad.status = 'leave' AND COALESCE(lt.is_paid, 0) = 0))`,
    [employeeId, fromDate, toDate]
  );
  return { workingDays, paymentDays: Math.max(0, workingDays - unpaid.n) };
}

export async function getStatutoryRates() {
  return queryOne('SELECT * FROM statutory_rates LIMIT 1');
}

const STATUTORY_RATE_FIELDS = ['pf_employee_pct', 'pf_employer_pct', 'pf_wage_ceiling', 'apply_pf_ceiling',
  'esi_employee_pct', 'esi_employer_pct', 'esi_wage_ceiling', 'standard_monthly_hours',
  'overtime_multiplier', 'standard_deduction', 'tds_rebate_income_threshold'];

// Single-row settings table, so unlike the other rate masters this is a patch, not an insert —
// shared by the PATCH route and the statutory-rates-hub sync (lib/rate-sync.js).
export async function patchStatutoryRates(fields) {
  const sets = [];
  const args = [];
  for (const key of STATUTORY_RATE_FIELDS) {
    if (fields[key] !== undefined) { sets.push(`${key} = ?`); args.push(fields[key]); }
  }
  if (!sets.length) throw new Error('No fields to update');
  sets.push('updated_at = CURRENT_TIMESTAMP');
  const current = await getStatutoryRates();
  args.push(current.id);
  await execute(`UPDATE statutory_rates SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function getProfessionalTaxSlab(state, gross) {
  const slab = await queryOne(
    `SELECT amount FROM professional_tax_slabs WHERE state = ? AND active = 1 AND min_gross <= ?
       AND (max_gross IS NULL OR max_gross >= ?) ORDER BY min_gross DESC LIMIT 1`,
    [state, gross, gross]
  );
  return slab ? slab.amount : 0;
}

// Progressive slab tax — each bracket's rate applies only to the portion of income inside it.
function computeAnnualTax(taxableIncome, slabs) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (const s of slabs) {
    const bandMax = s.max_income == null ? Infinity : s.max_income;
    if (taxableIncome <= s.min_income) continue;
    const amountInBand = Math.min(taxableIncome, bandMax) - s.min_income;
    if (amountInBand > 0) tax += amountInBand * (s.rate_pct / 100);
  }
  return tax;
}

// YTD-accurate TDS: project the full year's taxable income from what's actually been earned/
// deducted so far this FY (not a flat month×12 guess), tax it, then subtract what's already been
// deducted — correctly handles mid-year joiners and pay changes during the year.
async function computeTds(employee, financialYear, periodMonth, periodYear, thisMonthGross, thisMonthPf, rates) {
  const ytd = await queryOne(
    `SELECT COALESCE(SUM(gross_earnings),0) AS gross, COALESCE(SUM(pf_employee),0) AS pf, COALESCE(SUM(tds_amount),0) AS tds, COUNT(*) AS periods
       FROM salary_slips WHERE employee_id = ? AND financial_year = ? AND slip_type = 'regular' AND status != 'draft'
         AND NOT (period_month = ? AND period_year = ?)`,
    [employee.id, financialYear, periodMonth, periodYear]
  );
  // periodsElapsed counts actual prior slips (+ this one), not calendar months since joining — a
  // company adopting this payroll module mid-FY (paying earlier months a different way, so no
  // slip exists here for them) must not have those "missing" months silently averaged in and
  // dilute the annual projection. periodsTotal stays the calendar fact (the correct denominator
  // for annualizing whatever fraction of the year actually has slips).
  const periodsTotal = periodsTotalForFy(employee.date_of_joining, financialYear);
  const periodsElapsed = Math.min(periodsTotal, ytd.periods + 1);
  const taxableTillNow = (ytd.gross + thisMonthGross) - (ytd.pf + thisMonthPf);
  const projectedAnnualTaxable = round2((taxableTillNow / periodsElapsed) * periodsTotal - rates.standard_deduction);

  let annualTax = 0;
  if (projectedAnnualTaxable > rates.tds_rebate_income_threshold) {
    const slabs = await queryAll(
      "SELECT * FROM income_tax_slabs WHERE regime = 'new' AND financial_year = ? AND active = 1 ORDER BY min_income",
      [financialYear]
    );
    annualTax = round2(computeAnnualTax(projectedAnnualTaxable, slabs) * 1.04); // 4% health & education cess
  }
  const taxTillDate = annualTax * periodsElapsed / periodsTotal;
  return round2(Math.max(0, taxTillDate - ytd.tds));
}

function hoursBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

// Hours beyond each day's scheduled shift, valued at (Basic / standard_monthly_hours) ×
// overtime_multiplier (statutory OT is 2x ordinary rate under the Factories Act — the seeded
// default). Reuses §13's attendance_days.working_hours / getShiftForDate, nothing new to derive.
async function computeOvertime(employeeId, fromDate, toDate, basicAmount, rates) {
  const days = await queryAll(
    'SELECT date, working_hours FROM attendance_days WHERE employee_id = ? AND date BETWEEN ? AND ? AND working_hours IS NOT NULL',
    [employeeId, fromDate, toDate]
  );
  if (!days.length || !rates.standard_monthly_hours) return 0;
  const hourlyRate = basicAmount / rates.standard_monthly_hours;
  let otHours = 0;
  for (const d of days) {
    const shift = await getShiftForDate(employeeId, d.date);
    if (!shift?.start_time || !shift?.end_time) continue;
    const scheduled = hoursBetween(shift.start_time, shift.end_time);
    otHours += Math.max(0, d.working_hours - scheduled);
  }
  return round2(otHours * hourlyRate * rates.overtime_multiplier);
}

export function computeLoanEmi(principal, interestPct, tenureMonths) {
  if (!interestPct) return round2(principal / tenureMonths);
  const r = interestPct / 12 / 100;
  const factor = Math.pow(1 + r, tenureMonths);
  return round2((principal * r * factor) / (factor - 1));
}

// Pure compute — resolves the structure, statutory deductions, overtime and (for a 'final' slip)
// the exit adjustments into one breakdown. Does not touch the database beyond reads.
export async function computeSalarySlip(employeeId, periodMonth, periodYear, opts = {}) {
  const { slipType = 'regular', relievingDate = null } = opts;
  const employee = await queryOne('SELECT * FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw new Error('Employee not found');

  const periodStart = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  const monthEnd = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  // periodEnd truncates to the relieving date for a final slip (nothing was worked after it), but
  // proration below still divides by the FULL month's working days, never the truncated window's
  // own — dividing a truncated numerator by an equally-truncated denominator would wash out to ~1
  // and silently pay a full month's Basic for a half-month worked.
  let periodEnd = monthEnd;
  if (slipType === 'final' && relievingDate && relievingDate < monthEnd) periodEnd = relievingDate;

  const assignment = await queryOne(
    `SELECT * FROM salary_structure_assignments WHERE employee_id = ? AND active = 1 AND from_date <= ?
       ORDER BY from_date DESC LIMIT 1`,
    [employeeId, periodEnd]
  );
  if (!assignment) throw new Error('No active salary structure assignment for this employee');

  const financialYear = getFinancialYear(periodMonth, periodYear);
  const rates = await getStatutoryRates();
  const workingDays = await countWorkingDays(periodStart, monthEnd);
  const { paymentDays } = await computePaymentDays(employeeId, periodStart, periodEnd);
  const proration = workingDays > 0 ? Math.min(1, paymentDays / workingDays) : 1;

  const components = [{ name: 'Basic', component_type: 'earning', amount: round2(assignment.base * proration) }];
  const structRows = await queryAll(
    'SELECT * FROM salary_structure_components WHERE salary_structure_id = ? ORDER BY sort_order',
    [assignment.salary_structure_id]
  );
  for (const c of structRows) {
    const raw = c.calc_type === 'percent_of_basic' ? assignment.base * ((c.percent || 0) / 100) : (c.amount || 0);
    components.push({ name: c.name, component_type: c.component_type, amount: round2(raw * proration) });
  }

  const additional = await queryAll(
    'SELECT * FROM additional_salary WHERE employee_id = ? AND period_month = ? AND period_year = ?',
    [employeeId, periodMonth, periodYear]
  );
  for (const a of additional) components.push({ name: a.name, component_type: a.component_type, amount: a.amount });

  const basicAmount = components[0].amount;
  const grossBeforeOvertime = round2(components.filter(c => c.component_type === 'earning').reduce((s, c) => s + c.amount, 0));

  const overtimeAmount = slipType === 'regular' ? await computeOvertime(employeeId, periodStart, periodEnd, basicAmount, rates) : 0;
  if (overtimeAmount > 0) components.push({ name: 'Overtime', component_type: 'earning', amount: overtimeAmount });
  const grossEarnings = round2(grossBeforeOvertime + overtimeAmount);

  const pfWageBase = rates.apply_pf_ceiling ? Math.min(basicAmount, round2(rates.pf_wage_ceiling * proration)) : basicAmount;
  const pfEmployee = round2(pfWageBase * (rates.pf_employee_pct / 100));
  const pfEmployer = round2(pfWageBase * (rates.pf_employer_pct / 100));

  const esiEligible = grossEarnings <= rates.esi_wage_ceiling;
  const esiEmployee = esiEligible ? round2(grossEarnings * (rates.esi_employee_pct / 100)) : 0;
  const esiEmployer = esiEligible ? round2(grossEarnings * (rates.esi_employer_pct / 100)) : 0;

  const ptAmount = await getProfessionalTaxSlab(employee.pt_state, grossEarnings);
  const tdsAmount = slipType === 'regular'
    ? await computeTds(employee, financialYear, periodMonth, periodYear, grossEarnings, pfEmployee, rates)
    : 0; // a final slip's exit-month TDS is a true-up best left to the client's CA — out of scope here

  if (pfEmployee > 0) components.push({ name: 'Provident Fund', component_type: 'deduction', amount: pfEmployee });
  if (esiEmployee > 0) components.push({ name: 'ESI', component_type: 'deduction', amount: esiEmployee });
  if (ptAmount > 0) components.push({ name: 'Professional Tax', component_type: 'deduction', amount: ptAmount });
  if (tdsAmount > 0) components.push({ name: 'TDS', component_type: 'deduction', amount: tdsAmount });

  let loanRepaymentPlans = [];
  if (slipType === 'regular') {
    const loans = await queryAll("SELECT * FROM employee_loans WHERE employee_id = ? AND status = 'active'", [employeeId]);
    for (const loan of loans) {
      const r = loan.interest_pct / 12 / 100;
      const interestComponent = round2(loan.outstanding_principal * r);
      let principalComponent = round2(loan.emi_amount - interestComponent);
      if (principalComponent >= loan.outstanding_principal) principalComponent = loan.outstanding_principal;
      const emi = round2(principalComponent + interestComponent);
      const outstandingAfter = round2(loan.outstanding_principal - principalComponent);
      loanRepaymentPlans.push({ loan, emi, principalComponent, interestComponent, outstandingAfter });
      components.push({ name: `Loan EMI — ${loan.purpose || `Loan #${loan.id}`}`, component_type: 'deduction', amount: emi });
    }
  }

  let advancesRecovered = [], loansForeclosed = [];
  if (slipType === 'final') {
    const separation = await queryOne('SELECT * FROM employee_separation WHERE employee_id = ? ORDER BY id DESC LIMIT 1', [employeeId]);
    if (separation?.leave_encashed && separation.encashment_amount) {
      components.push({ name: 'Leave Encashment', component_type: 'earning', amount: separation.encashment_amount });
    }
    const advances = await queryAll("SELECT * FROM employee_advances WHERE employee_id = ? AND status != 'settled'", [employeeId]);
    for (const adv of advances) {
      const outstanding = round2(adv.amount - adv.settled_amount);
      if (outstanding > 0) { advancesRecovered.push({ id: adv.id, amount: outstanding }); components.push({ name: `Advance Recovery — #${adv.id}`, component_type: 'deduction', amount: outstanding }); }
    }
    const loans = await queryAll("SELECT * FROM employee_loans WHERE employee_id = ? AND status = 'active'", [employeeId]);
    for (const loan of loans) {
      if (loan.outstanding_principal > 0) { loansForeclosed.push({ id: loan.id, amount: loan.outstanding_principal }); components.push({ name: `Loan Foreclosure — #${loan.id}`, component_type: 'deduction', amount: loan.outstanding_principal }); }
    }
  }

  const finalGross = round2(components.filter(c => c.component_type === 'earning').reduce((s, c) => s + c.amount, 0));
  const totalDeductions = round2(components.filter(c => c.component_type === 'deduction').reduce((s, c) => s + c.amount, 0));
  const netPay = round2(finalGross - totalDeductions);

  return {
    employee, assignment, financialYear, periodStart, periodEnd, workingDays, paymentDays,
    components, grossEarnings: finalGross, totalDeductions, netPay,
    pfEmployee, pfEmployer, esiEmployee, esiEmployer, ptAmount, tdsAmount, overtimeAmount,
    loanRepaymentPlans, advancesRecovered, loansForeclosed,
  };
}

// Persistence entrypoint — one function every generation path uses (payroll run, ad-hoc single
// slip, Full & Final settlement), so the slip row/components/loan-ledger writes can never drift
// between call sites (same "one function, every caller" precedent as createEmployeeWithOnboarding).
export async function generateSalarySlip(employeeId, periodMonth, periodYear, opts = {}) {
  const { payrollRunId = null, slipType = 'regular', relievingDate = null, createdBy = null } = opts;
  const computed = await computeSalarySlip(employeeId, periodMonth, periodYear, { slipType, relievingDate });

  const { lastId } = await execute(
    `INSERT INTO salary_slips (payroll_run_id, employee_id, salary_structure_assignment_id, period_month,
        period_year, financial_year, slip_type, working_days, payment_days, gross_earnings, total_deductions,
        net_pay, pf_employee, pf_employer, esi_employee, esi_employer, pt_amount, tds_amount, overtime_amount,
        created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payrollRunId, employeeId, computed.assignment.id, periodMonth, periodYear, computed.financialYear, slipType,
      computed.workingDays, computed.paymentDays, computed.grossEarnings, computed.totalDeductions, computed.netPay,
      computed.pfEmployee, computed.pfEmployer, computed.esiEmployee, computed.esiEmployer,
      computed.ptAmount, computed.tdsAmount, computed.overtimeAmount, createdBy]
  );
  const slipId = Number(lastId);

  let sortOrder = 0;
  for (const c of computed.components) {
    await execute(
      'INSERT INTO salary_slip_components (salary_slip_id, name, component_type, amount, sort_order) VALUES (?, ?, ?, ?, ?)',
      [slipId, c.name, c.component_type, c.amount, sortOrder++]
    );
  }

  for (const plan of computed.loanRepaymentPlans) {
    const countRow = await queryOne('SELECT COUNT(*) AS n FROM loan_repayments WHERE loan_id = ?', [plan.loan.id]);
    await execute(
      `INSERT INTO loan_repayments (loan_id, salary_slip_id, installment_no, emi_amount, principal_component,
          interest_component, outstanding_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [plan.loan.id, slipId, countRow.n + 1, plan.emi, plan.principalComponent, plan.interestComponent, plan.outstandingAfter]
    );
    await execute('UPDATE employee_loans SET outstanding_principal = ?, status = ? WHERE id = ?',
      [plan.outstandingAfter, plan.outstandingAfter <= 0 ? 'closed' : 'active', plan.loan.id]);
  }

  for (const adv of computed.advancesRecovered) {
    await execute("UPDATE employee_advances SET settled_amount = settled_amount + ?, status = 'settled' WHERE id = ?", [adv.amount, adv.id]);
  }
  for (const loan of computed.loansForeclosed) {
    await execute("UPDATE employee_loans SET outstanding_principal = 0, status = 'foreclosed' WHERE id = ?", [loan.id]);
  }

  return { slipId, netPay: computed.netPay };
}
