// lib/hr.js — V3_CHANGES.md §12. Pure HR domain logic: leave balance and working-days math.
// Balance is ALWAYS computed here, never stored as a running counter on leave_allocations — the
// exact denormalized-drift failure mode documented at the end of SYSTEM.md (purchase_status found
// stale independently three times across three different consumers). One function, every caller
// uses it, no drift possible by construction.
import { queryAll, queryOne, execute, nextCounterValue } from './db';
import { toISODate } from './date';

// ponytail: weekly-off is a single hardcoded day (Sunday), not a per-employee/per-shift
// configurable list. Upgrade path: a `weekly_off_days` column on shift_types or employees if a
// 6-day-week or Friday-off shift ever needs modeling — not needed yet, nothing in the current
// data asks for it.
const WEEKLY_OFF_DAY = 0; // Sunday, JS Date.getDay()

export function isWorkingDay(dateStr, holidaySet) {
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() === WEEKLY_OFF_DAY) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}

export async function getHolidaySet(fromDate, toDate) {
  const rows = await queryAll(
    'SELECT holiday_date FROM holidays WHERE holiday_date BETWEEN ? AND ?',
    [fromDate, toDate]
  );
  return new Set(rows.map(r => r.holiday_date));
}

// Working days between two dates inclusive, excluding weekly-offs and holidays — the number
// attendance % should divide by, not raw calendar days (the bug WorkersPanel.jsx currently has).
export async function countWorkingDays(fromDate, toDate) {
  const holidays = await getHolidaySet(fromDate, toDate);
  let count = 0;
  const cur = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (cur <= end) {
    // toISODate, never .toISOString().slice(0,10) — the latter converts through UTC first and
    // shifts the calendar day for any non-UTC server timezone (lib/date.js's documented IST
    // gotcha; SYSTEM.md §18). Found live during V3_CHANGES.md §12 verification.
    const iso = toISODate(cur);
    if (isWorkingDay(iso, holidays)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Leave balance = allocated − approved days for that employee/type/year. Computed fresh every
// call — cheap at this company's scale (a handful of employees), and correctness > a cached number.
export async function getLeaveBalance(employeeId, leaveTypeId, year) {
  const [alloc, used] = await Promise.all([
    queryOne(
      'SELECT allocated FROM leave_allocations WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [employeeId, leaveTypeId, year]
    ),
    queryOne(
      `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
        WHERE employee_id = ? AND leave_type_id = ? AND status = 'approved'
          AND strftime('%Y', from_date) = ?`,
      [employeeId, leaveTypeId, String(year)]
    ),
  ]);
  const allocated = alloc?.allocated ?? 0;
  return { allocated, used: used.used, balance: allocated - used.used };
}

// Inclusive day count between two ISO dates — leave_requests.days is stored numerically (never
// parsed from free text), same "capture the number at request time" precedent bom_items.inventory_qty
// already uses for reservation math.
export function daysBetween(fromDate, toDate) {
  const a = new Date(fromDate + 'T00:00:00');
  const b = new Date(toDate + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

// V3_CHANGES.md §13 — the shift assignment covering a specific attendance date (not "now", the
// way getEmployeeDetail's currentShift lookup works — attendance can be marked/edited for a past
// date under a shift the employee has since rotated off).
export async function getShiftForDate(employeeId, date) {
  return queryOne(
    `SELECT st.start_time, st.end_time, st.grace_minutes FROM shift_assignments sa JOIN shift_types st ON st.id = sa.shift_type_id
      WHERE sa.employee_id = ? AND sa.from_date <= ? AND (sa.to_date IS NULL OR sa.to_date >= ?)
      ORDER BY sa.from_date DESC LIMIT 1`,
    [employeeId, date, date]
  );
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// working_hours from a punch pair (handles an overnight shift where out < in). late_entry/
// early_exit only evaluate against a shift's start/end when the employee actually has one
// assigned for that date — no shift, no comparison, stays 0. graceMinutes (shift_types
// .grace_minutes, HR core leftover closed post-§13) shifts the late/early threshold by that many
// minutes each way — no biometric-log reconciliation beyond that.
export function deriveAttendanceMetrics(inTime, outTime, shiftStart, shiftEnd, graceMinutes = 0) {
  let workingHours = null;
  if (inTime && outTime) {
    const inMin = timeToMinutes(inTime);
    let outMin = timeToMinutes(outTime);
    if (outMin <= inMin) outMin += 24 * 60;
    workingHours = Math.round(((outMin - inMin) / 60) * 100) / 100;
  }
  const lateEntry = inTime && shiftStart && timeToMinutes(inTime) > timeToMinutes(shiftStart) + graceMinutes ? 1 : 0;
  const earlyExit = outTime && shiftEnd && timeToMinutes(outTime) < timeToMinutes(shiftEnd) - graceMinutes ? 1 : 0;
  return { workingHours, lateEntry, earlyExit };
}

// Default checklists seeded onto a new employee_onboarding / employee_separation record — same
// "seed a default template, editable per-instance afterward" precedent Workflow Stages already
// established (SYSTEM.md §3c), kept as plain constants here rather than a second configurable-
// template table since these two lists are short and don't (yet) need per-department variants.
export const DEFAULT_ONBOARDING_TASKS = [
  'Collect ID proof / documents', 'Issue employee code & ID card', 'Assign department & designation',
  'IT/device setup (if applicable)', 'Induction briefing', 'Add to attendance/leave system',
];
export const DEFAULT_SEPARATION_TASKS = [
  'Exit interview', 'Handover pending work', 'Return company assets', 'Clear pending leave/attendance',
  'Deactivate access (device/login)', 'Final settlement note',
];

// The "accept -> auto-create the next record" playbook (V3_CHANGES.md §12 decision 7), for
// employee creation specifically — two real call sites: a direct new-hire (POST /api/employees)
// and a Recruitment hire (job_applicant.status='hired', POST /api/job-applicants/[id]). One
// function, both use it, so the onboarding-seed step can never drift between the two paths.
export async function createEmployeeWithOnboarding(fields) {
  const seq = await nextCounterValue('employee_code', 1000);
  const employeeCode = `EMP-${seq}`;
  const { lastId } = await execute(
    `INSERT INTO employees
       (employee_code, name, employee_type, designation_id, employment_type_id, department, trade, user_id,
        date_of_joining, phone, email, gender, date_of_birth, photo_url, reports_to, current_address,
        permanent_address, emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        personal_email, scheduled_confirmation_date, contract_end_date, notice_period_days,
        date_of_retirement, salary_mode, bank_name, bank_account_no, bank_ifsc, ctc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [employeeCode, fields.name, fields.employee_type === 'worker' ? 'worker' : 'staff',
      fields.designation_id || null, fields.employment_type_id || null, fields.department || null,
      fields.trade || null, fields.user_id || null, fields.date_of_joining || null, fields.phone || null,
      fields.email || null, fields.gender || null, fields.date_of_birth || null, fields.photo_url || null,
      fields.reports_to || null, fields.current_address || null, fields.permanent_address || null,
      fields.emergency_contact_name || null, fields.emergency_contact_phone || null,
      fields.emergency_contact_relation || null, fields.personal_email || null,
      fields.scheduled_confirmation_date || null, fields.contract_end_date || null,
      fields.notice_period_days || null, fields.date_of_retirement || null, fields.salary_mode || null,
      fields.bank_name || null, fields.bank_account_no || null, fields.bank_ifsc || null, fields.ctc || null]
  );
  const employeeId = Number(lastId);
  const { lastId: onboardingId } = await execute('INSERT INTO employee_onboarding (employee_id) VALUES (?)', [employeeId]);
  let sortOrder = 0;
  for (const task of DEFAULT_ONBOARDING_TASKS) {
    await execute('INSERT INTO onboarding_tasks (onboarding_id, task, sort_order) VALUES (?, ?, ?)', [Number(onboardingId), task, sortOrder++]);
  }
  return { employeeId, employeeCode };
}
