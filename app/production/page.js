import { redirect } from 'next/navigation';
import { getSessionUser, inDepartment, roleHome } from '@/lib/auth';
import { getProductionCalendar, getOpenProductionTasks, getFunctionalHeads } from '@/lib/data';
import { todayISO, todayMonth, monthGridBounds } from '@/lib/date';
import PageHeader from '@/components/PageHeader';
import ProductionToday from '@/components/ProductionToday';

export const dynamic = 'force-dynamic';

export default async function ProductionTodayPage({ searchParams }) {
  const user = getSessionUser();
  // Strictly the department's own people — inDepartment, not canAccessDepartment (a PM passes
  // that one). No redirect loop: roleHome only returns /production for members.
  if (!inDepartment(user, 'Production')) redirect(roleHome(user));

  // Validate before this reaches date math and a SQL bound param.
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month || '') ? searchParams.month : todayMonth();
  const [from, to] = monthGridBounds(month);
  const today = todayISO();

  const [events, openTasks, heads] = await Promise.all([
    getProductionCalendar(from, to),
    getOpenProductionTasks(today),
    getFunctionalHeads(),
  ]);
  // Assignable = operators actually in Production. Picks up new heads automatically.
  const operators = heads.filter(o => o.active && o.departments.includes('Production'));

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Today" description="Tasks and production milestones for the shop floor" />
      <ProductionToday
        month={month}
        today={today}
        events={events}
        openTasks={openTasks}
        operators={operators}
      />
    </main>
  );
}
