// Who may open the Shop and who may change its photos (SYSTEM.md §5fh).
// ponytail: signed-in only for now; opening it to everyone = add /shop and /api/shop/images to
// PUBLIC_PATHS in middleware.js and let canViewShop accept no user.
import { isCustomer, isInternal, canAccessDepartment } from './auth';

export const canViewShop = user => isCustomer(user) || isInternal(user);
// admin / manager / executive pass canAccessDepartment for every department.
export const canEditShop = user => isInternal(user) && canAccessDepartment(user, 'Sales');
