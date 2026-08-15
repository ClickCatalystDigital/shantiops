import { redirect } from 'next/navigation';
import { getFreshSessionUser, isHead, isManager, headDepartments, roleHome } from '@/lib/auth';
import { DEPARTMENTS } from '@/lib/milestones';
import {
  getDepartmentCalendar, getOpenDepartmentTasks, getFunctionalHeads,
} from '@/lib/data';
import { todayISO, todayMonth, monthGridBounds, weekBounds, yearBounds } from '@/lib/date';
import ProductionToday from '@/components/ProductionToday';

export const dynamic = 'force-dynamic';

const VIEWS = ['month', 'week', 'year'];

export default async function ProductionTodayPage({ searchParams }) {
  const user = await getFreshSessionUser();
  const manager = isManager(user);
  const allowedDepartments = manager ? DEPARTMENTS : headDepartments(user);
  if ((!manager && !isHead(user)) || allowedDepartments.length === 0) redirect(roleHome(user));

  const requestedDept = searchParams?.dept || null;
  const deptFilter = requestedDept && allowedDepartments.includes(requestedDept) ? requestedDept : null;
  const deptsToShow = deptFilter ? [deptFilter] : allowedDepartments;

  const today = todayISO();
  // Validate before any of this reaches date math and a SQL bound param.
  const view = VIEWS.includes(searchParams?.view) ? searchParams.view : 'month';
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month || '') ? searchParams.month : todayMonth();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date || '') ? searchParams.date : today;
  const year = /^\d{4}$/.test(searchParams?.year || '') ? Number(searchParams.year) : Number(today.slice(0, 4));

  const [from, to] = view === 'week' ? weekBounds(date) : view === 'year' ? yearBounds(year) : monthGridBounds(month);

  const [events, openTasks, heads] = await Promise.all([
    getDepartmentCalendar(deptsToShow, from, to),
    getOpenDepartmentTasks(deptsToShow, today),
    getFunctionalHeads(),
  ]);
  // Assignable = operators actually in one of the departments being shown. Picks up new heads automatically.
  const operators = heads.filter(o => o.active && o.departments.some(d => deptsToShow.includes(d)));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <ProductionToday
        view={view}
        month={month}
        date={date}
        year={year}
        today={today}
        deptFilter={deptFilter}
        deptsToShow={deptsToShow}
        events={events}
        openTasks={openTasks}
        operators={operators}
      />
    </main>
  );
}
