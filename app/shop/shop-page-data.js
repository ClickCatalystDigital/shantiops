// Shared by the Shop pages (SYSTEM.md §5fh): who is looking, and the catalog.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, isCustomer, roleHome } from '@/lib/auth';
import { canViewShop, canEditShop } from '@/lib/shop-access';
import { getShopCatalog } from '@/lib/data';

export async function loadShop(next) {
  const user = await getFreshSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (isCustomer(user) && user.must_change_password && process.env.DEMO_MODE !== '1') redirect('/change-password'); // demo: no password step
  if (!canViewShop(user)) redirect(roleHome(user));
  return { user, customer: isCustomer(user), canEdit: canEditShop(user), ...(await getShopCatalog()) };
}
