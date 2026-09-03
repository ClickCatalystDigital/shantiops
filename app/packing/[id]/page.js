import { notFound, redirect } from 'next/navigation';
import { getPackingDetail } from '@/lib/data';
import { getFreshSessionUser, isCustomer, canAccessDepartment, canAccessProject, roleHome } from '@/lib/auth';
import PackingDetail from '@/components/PackingDetail';

export const dynamic = 'force-dynamic';

export default async function PackingPage({ params }) {
  const user = await getFreshSessionUser();
  const data = await getPackingDetail(params.id);
  if (!data) notFound();

  const canEdit = canAccessDepartment(user, 'Dispatch'); // PM or a Dispatch functional head
  // Accounts gets full read-only visibility here — freight, e-way bill, invoice link, delivery
  // acknowledgement, the whole document — for reconciliation, instead of being limited to the
  // flat Dispatch/E-Way Bill/Freight report exports. Editing e-way bill/freight stays Dispatch-only
  // (they're the ones physically handling the shipment); this is view access only.
  const canView = canEdit || canAccessDepartment(user, 'Accounts');

  if (isCustomer(user)) {
    // A customer may only see their own order's list, and only once it's past draft (≥ Ready).
    if (!canAccessProject(user, data.list.project_id) || data.list.status === 'draft') {
      redirect(roleHome(user));
    }
  } else if (!canView) {
    // Internal users without Dispatch or Accounts access have no business on the packing board.
    redirect(roleHome(user));
  }

  return <PackingDetail list={data.list} items={data.items} readOnly={!canEdit} />;
}
