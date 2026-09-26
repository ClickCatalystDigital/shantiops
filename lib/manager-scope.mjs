// Project Managers (role 'manager') work the factory but not the business-side departments.
// admin and executive are unaffected.
export const MANAGER_BLOCKED_DEPARTMENTS = ['Marketing', 'Accounts', 'HR'];

export function departmentsFor(user, list) {
  return user?.role === 'manager' ? list.filter(d => !MANAGER_BLOCKED_DEPARTMENTS.includes(d)) : list;
}
