import { redirect } from 'next/navigation';
import { getSessionUser, isCustomer, isPM, headDepartments, roleHome } from '@/lib/auth';
import { getTickets } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import TicketsPanel from '@/components/TicketsPanel';

export const dynamic = 'force-dynamic';

export default async function TicketsPage() {
  const user = getSessionUser();
  if (isCustomer(user)) redirect(roleHome(user));

  const pm = isPM(user);
  const myDepts = headDepartments(user);
  // One query either way; a head's per-department cards filter it client-side, same as
  // DepartmentPanel already does for milestones.
  const tickets = await getTickets({});

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Tickets"
        description={pm
          ? 'Cross-department handoffs, rework, and requests — every department'
          : 'Handoffs, rework, and requests for your department(s)'} />
      {pm ? (
        <TicketsPanel tickets={tickets} showDepartment canRaise />
      ) : myDepts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No department assigned yet — contact your PM.</p>
      ) : (
        myDepts.map(d => (
          <TicketsPanel key={d} title={d} department={d} canRaise
            tickets={tickets.filter(t => t.to_department === d || t.from_department === d)} />
        ))
      )}
    </main>
  );
}
