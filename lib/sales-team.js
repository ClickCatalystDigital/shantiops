// lib/sales-team.js — shared by the /api/sales-team routes. A Sales Head (or any PM) manages the
// SALES people only: operators whose access is just Sales. Anyone with another department, or a PM
// role, is out of reach here — those stay with Settings → Access (PM only). Keeps the HR-first rule:
// logins are created from active HR employees in the Sales department, never from thin air.
import { queryAll, queryOne } from '@/lib/db';
import { parseDepartmentRoles } from '@/lib/auth';

export const salesDeptsOnly = depts => {
  const list = String(depts || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length > 0 && list.every(d => d === 'Sales');
};

export async function listSalesTeam() {
  const rows = await queryAll(
    `SELECT u.id, u.username, u.display_name, u.active, u.departments, u.department_roles, d.name AS designation, e.id AS employee_id
       FROM users u LEFT JOIN employees e ON e.user_id = u.id LEFT JOIN designations d ON d.id = e.designation_id
      WHERE u.role = 'operator' AND u.pending = 0 AND INSTR(',' || COALESCE(u.departments, '') || ',', ',Sales,') > 0
      ORDER BY u.active DESC, u.display_name, u.username`);
  const members = rows.map(r => ({
    id: r.id, username: r.username, name: r.display_name || r.username, active: !!r.active, designation: r.designation || null,
    role: parseDepartmentRoles(r.department_roles).Sales === 'head' ? 'head' : 'member',
    salesOnly: salesDeptsOnly(r.departments), otherDepartments: String(r.departments || '').split(',').filter(d => d && d !== 'Sales'),
  }));
  const available = await queryAll(
    "SELECT e.id, e.employee_code, e.name, d.name AS designation FROM employees e LEFT JOIN designations d ON d.id = e.designation_id WHERE e.active = 1 AND e.user_id IS NULL AND e.department = 'Sales' ORDER BY e.name");
  return { members, available };
}

// The row a change targets, or an { error, status } when it is out of this screen's reach.
export async function salesTarget(id) {
  const t = await queryOne('SELECT id, username, role, departments, department_roles, active FROM users WHERE id = ?', [id]);
  if (!t) return { error: 'Not found', status: 404 };
  if (t.role !== 'operator' || !String(t.departments || '').split(',').includes('Sales')) {
    return { error: 'Only Sales team members can be managed here', status: 403 };
  }
  return { target: t };
}
