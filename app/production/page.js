import { redirect } from 'next/navigation';
import { getSessionUser, isHead, headDepartments, roleHome } from '@/lib/auth';
import {
  getDepartmentCalendar, getOpenDepartmentTasks, getResolvedTicketCount, getTickets, getFunctionalHeads,
} from '@/lib/data';
import { todayISO, todayMonth, monthGridBounds, weekBounds, yearBounds } from '@/lib/date';
import PageHeader from '@/components/PageHeader';
import ProductionToday from '@/components/ProductionToday';

export const dynamic = 'force-dynamic';

const VIEWS = ['month', 'week', 'year'];

export default async function ProductionTodayPage({ searchParams }) {
  const user = getSessionUser();
  // Any granted department — PMs stay locked out (headDepartments is [] for them by
  // construction), same exclusion as before, just no longer Production-specific.
  if (!isHead(user) || headDepartments(user).length === 0) redirect(roleHome(user));

  const deptFilter = searchParams?.dept || null;
  const deptsToShow = deptFilter ? [deptFilter] : headDepartments(user);

  const today = todayISO();
  // Validate before any of this reaches date math and a SQL bound param.
  const view = VIEWS.includes(searchParams?.view) ? searchParams.view : 'month';
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month || '') ? searchParams.month : todayMonth();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date || '') ? searchParams.date : today;
  const year = /^\d{4}$/.test(searchParams?.year || '') ? Number(searchParams.year) : Number(today.slice(0, 4));

  const [from, to] = view === 'week' ? weekBounds(date) : view === 'year' ? yearBounds(year) : monthGridBounds(month);

  const [events, openTasks, resolvedTicketCount, ticketsByDept, heads] = await Promise.all([
    getDepartmentCalendar(deptsToShow, from, to),
    getOpenDepartmentTasks(deptsToShow, today),
    getResolvedTicketCount(deptsToShow, from, to),
    Promise.all(deptsToShow.map(d => getTickets({ department: d, status: 'open' }))),
    getFunctionalHeads(),
  ]);
  // Unbounded-by-view open tickets for the "To dos" rail — same treatment openTasks already gets.
  // A ticket between two of the head's own departments could surface from both queries; dedupe by id.
  const openTickets = [...new Map(ticketsByDept.flat().map(t => [t.id, t])).values()];
  // Assignable = operators actually in one of the departments being shown. Picks up new heads automatically.
  const operators = heads.filter(o => o.active && o.departments.some(d => deptsToShow.includes(d)));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Tasks"
        description={deptFilter ? `${deptFilter} tasks and milestones` : 'Tasks and milestones across your departments'} />
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
        openTickets={openTickets}
        resolvedTicketCount={resolvedTicketCount}
        operators={operators}
      />
    </main>
  );
}
