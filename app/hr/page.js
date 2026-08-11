// app/hr/page.js — V3_CHANGES.md §12 Phase 3g. HR's own cross-project workspace, same gating
// mechanism as /procurement, /qc, /sales (components/Nav.jsx's inHr).
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import {
  getEmployees, getDesignations, getEmploymentTypes, getLeaveTypes, getLeaveRequests,
  getHolidays, getShiftTypes, getShiftAssignments, getJobOpenings, getAttendanceForDate,
  getSalaryStructures, getSalaryStructureAssignments, getPayrollRuns, getSalarySlips,
  getProfessionalTaxSlabs, getIncomeTaxSlabs, getEmployeeLoans, getAdditionalSalary,
  getExpenseClaimTypes, getExpenseClaims, getEmployeeAdvances,
} from '@/lib/data';
import { getStatutoryRates } from '@/lib/payroll';
import { todayISO } from '@/lib/date';
import PageHeader from '@/components/PageHeader';
import HrWorkspace from '@/components/HrWorkspace';

export const dynamic = 'force-dynamic';

export default async function HrPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'HR')) redirect(roleHome(user));

  const today = todayISO();
  const [
    employees, designations, employmentTypes, leaveTypes, leaveRequests,
    holidays, shiftTypes, shiftAssignments, jobOpenings, attendanceToday,
    salaryStructures, salaryAssignments, payrollRuns, salarySlips, statutoryRates,
    ptSlabs, taxSlabs, employeeLoans, additionalSalary, expenseClaimTypes, expenseClaims, employeeAdvances,
  ] = await Promise.all([
    getEmployees(), getDesignations(), getEmploymentTypes(), getLeaveTypes(), getLeaveRequests('pending'),
    getHolidays(), getShiftTypes(), getShiftAssignments(), getJobOpenings(), getAttendanceForDate(today),
    getSalaryStructures(), getSalaryStructureAssignments(), getPayrollRuns(), getSalarySlips(),
    getStatutoryRates(), getProfessionalTaxSlabs(), getIncomeTaxSlabs(), getEmployeeLoans(), getAdditionalSalary(),
    getExpenseClaimTypes(), getExpenseClaims(), getEmployeeAdvances(),
  ]);

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="HR" description="Employees, attendance, leave, shifts and recruitment" />
      <HrWorkspace
        employees={employees} designations={designations} employmentTypes={employmentTypes}
        leaveTypes={leaveTypes} pendingLeaveRequests={leaveRequests} holidays={holidays}
        shiftTypes={shiftTypes} shiftAssignments={shiftAssignments} jobOpenings={jobOpenings}
        attendanceToday={attendanceToday} today={today}
        salaryStructures={salaryStructures} salaryAssignments={salaryAssignments}
        payrollRuns={payrollRuns} salarySlips={salarySlips} statutoryRates={statutoryRates}
        ptSlabs={ptSlabs} taxSlabs={taxSlabs} employeeLoans={employeeLoans} additionalSalary={additionalSalary}
        expenseClaimTypes={expenseClaimTypes} expenseClaims={expenseClaims} employeeAdvances={employeeAdvances}
      />
    </main>
  );
}
