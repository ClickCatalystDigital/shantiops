// Project Managers (role 'manager') work the factory but not the business-side departments.
// admin and executive are unaffected.
export const MANAGER_BLOCKED_DEPARTMENTS = ['Marketing', 'Accounts', 'HR'];

// Departments this deployment offers. A client that bought a subset sets ENABLED_DEPARTMENTS
// (e.g. "QC"); unset = every department (demos, full deployments). The server reads the env; the
// browser reads the copy app/layout.js writes into globalThis.__sbEnabledDepts.
export function enabledDepartments() {
  const raw = typeof window === 'undefined' ? process.env.ENABLED_DEPARTMENTS : globalThis.__sbEnabledDepts;
  if (Array.isArray(raw)) return raw;
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}
export function isDepartmentEnabled(dept) {
  const on = enabledDepartments();
  return !on || on.includes(dept);
}

export function departmentsFor(user, list) {
  const on = list.filter(isDepartmentEnabled);
  return user?.role === 'manager' ? on.filter(d => !MANAGER_BLOCKED_DEPARTMENTS.includes(d)) : on;
}
