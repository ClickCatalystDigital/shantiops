// lib/auth.js
import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { queryOne } from './db';

// Never silently use a known secret in a deployed build. Development keeps a local-only
// fallback so a fresh checkout remains runnable, while production fails closed on the first
// attempt to sign or verify a session.
const JWT_SECRET = process.env.SESSION_SECRET || null;
const COOKIE_NAME = 'token';

function jwtSecret() {
  if (JWT_SECRET) return JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be configured before authentication is used');
  }
  return 'dev-only-insecure-secret';
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      project_id: user.project_id ?? null,
      project_ids: parseProjectIds(user.project_ids ?? user.project_id),
      departments: parseDepartments(user.departments),
      display_name: user.display_name ?? null,
      safe_pass: !!user.safe_pass,
    },
    jwtSecret(),
    { expiresIn: '12h' }
  );
}

// Departments are stored as a CSV string on the user row; the token/UI want an array.
export function parseDepartments(csv) {
  if (Array.isArray(csv)) return csv;
  if (!csv) return [];
  return String(csv).split(',').map(s => s.trim()).filter(Boolean);
}

export function parseDepartmentRoles(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

// A customer may own several projects (CSV on users.project_ids, same idiom as departments).
// Legacy single-project rows (users.project_id) still work via the signToken fallback above.
export function parseProjectIds(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === '') return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

// For use inside Route Handlers / Server Components (reads the httpOnly cookie).
export function getSessionUser() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// API authorization must reflect the current database row, not a potentially stale JWT claim.
// Keep getSessionUser() synchronous for existing server-component callers; route handlers use
// this async variant so deactivation and permission changes take effect without waiting for the
// token's expiry.
export async function getFreshSessionUser() {
  const claims = getSessionUser();
  if (!claims?.id) return null;
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND active = 1 AND pending = 0', [claims.id]);
  if (!user) return null;
  const { password: _password, ...safeUser } = user;
  return {
    ...claims,
    ...safeUser,
    project_ids: parseProjectIds(safeUser.project_ids ?? safeUser.project_id),
    departments: parseDepartments(safeUser.departments),
    department_roles: parseDepartmentRoles(safeUser.department_roles),
    safe_pass: !!safeUser.safe_pass,
  };
}

// For use inside Route Handlers when you need to read an Authorization header instead.
export function getUserFromRequest(req) {
  const authHeader = req.headers.get?.('authorization') || headers().get('authorization');
  const bearer = authHeader?.replace('Bearer ', '');
  const cookieToken = cookies().get(COOKIE_NAME)?.value;
  const token = bearer || cookieToken;
  if (!token) return null;
  return verifyToken(token);
}

// Long-lived per-machine token for the USB agent. Shown once at machine creation, never stored;
// revocation is the machines.active flag, checked on every agent call.
export function signAgentToken(machineId) {
  return jwt.sign({ role: 'agent', machine_id: machineId }, jwtSecret(), { expiresIn: '365d' });
}

export const COOKIE_OPTS = {
  name: COOKIE_NAME,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 12 * 60 * 60
};

export const APPROVER_ROLES = ['admin', 'manager', 'executive'];
export function isApprover(user) {
  return !!user && APPROVER_ROLES.includes(user.role);
}

// Role tiers. Internal = runs the factory; external = the customer who placed the order.
export function isCustomer(user) { return user?.role === 'customer'; }
// Stricter than isPM/requirePM — safe_pass grants (below) are admin-only, not manager/executive.
export function isAdmin(user) { return user?.role === 'admin'; }
// Machine tokens (USB agents) must never pass as a human session — excluded from isInternal.
export function isAgent(user) { return user?.role === 'agent'; }
export function isInternal(user) { return !!user && !isCustomer(user) && !isAgent(user); }
// executive: full PM powers + sits above PM in the approval hierarchy (see canApproveUser).
export function isManager(user) { return !!user && ['admin', 'manager', 'executive'].includes(user.role); } // sees Executive

// Redesign role model: admin/manager collapse into "PM"; operator becomes "Functional Head".
export function isPM(user) { return isManager(user); }
export function isHead(user) { return user?.role === 'operator'; }
export function headDepartments(user) { return parseDepartments(user?.departments); }
export function departmentRole(user, dept) {
  if (isPM(user)) return 'head';
  return parseDepartmentRoles(user?.department_roles)[dept] || 'designer';
}
// Generic department-agnostic responsibility checks (lib/department-roles.js is the label side of
// this — the stored value 'head'/'designer' is uniform across every department by design, so these
// two never need a per-department special case). isDesignHead/isDesignDesigner below are now thin
// Design-specific aliases kept for their many existing call sites (formula approval, drawing
// deletion, project creation — real Design-only business rules, not something to generalize).
export function isDepartmentHead(user, dept) {
  return isPM(user) || (canAccessDepartment(user, dept) && departmentRole(user, dept) === 'head');
}
export function isDepartmentMember(user, dept) {
  return canAccessDepartment(user, dept) && departmentRole(user, dept) === 'designer';
}
export function isDesignHead(user) { return isDepartmentHead(user, 'Design'); }
export function isDesignDesigner(user) { return isDepartmentMember(user, 'Design'); }

export async function hasActiveDepartmentResponsibility(user, dept, responsibility) {
  if (isPM(user)) return responsibility === 'head' || responsibility === 'designer';
  const row = await queryOne(
    `SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id
      WHERE e.user_id = ? AND (e.department = ? OR INSTR(',' || COALESCE(e.access_departments, '') || ',', ',' || ? || ',') > 0)
        AND e.active = 1 AND u.active = 1 AND u.pending = 0`,
    [user?.id, dept, dept]
  );
  return !!row && (departmentRole(user, dept) === responsibility);
}

// Permission grants are cached in the session for navigation, but sensitive mutations also
// verify the linked HR row so deactivation immediately removes Design responsibility.
export async function hasActiveDesignResponsibility(user, responsibility) {
  return hasActiveDepartmentResponsibility(user, 'Design', responsibility);
}
export function canManageDesignAccess(user) {
  return isAdmin(user) || ['manager', 'executive'].includes(user?.role) || isDesignHead(user);
}

// Demo-only escape hatch: named accounts skip the device-setup gate (app/layout.js) so a
// walkthrough never gets stuck on "your machine isn't registered yet". ponytail: env
// allowlist, not a DB column — unset DEMO_USERS to remove it entirely.
const DEMO_USERS = (process.env.DEMO_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
export function isDemoUser(user) { return !!user && DEMO_USERS.includes(user.username); }

// Admin-granted onboarding bypass (Settings → User Management, admin-only toggle). DB-backed,
// unlike DEMO_USERS — an admin can grant/revoke it per-user without touching env vars or a
// redeploy. Same effect as isDemoUser at every call site that checks it.
export function hasSafePass(user) { return !!user?.safe_pass; }

// Seeded bootstrap PM accounts only — always allowed to log in unblocked, since someone has to
// be free to register machines / approve people. Any OTHER manager is self-registered (the
// self-register form lets people pick "Project Manager") and gets the same device-setup gate as
// a head — otherwise picking that option at registration is a way to skip enrollment entirely.
const BOOTSTRAP_PMS = ['admin', 'manager', 'executive'];
export function needsDeviceEnrollment(user) {
  return isHead(user) || (user?.role === 'manager' && !BOOTSTRAP_PMS.includes(user.username));
}

// PM can reach every department; a head only their granted list. Customers: never.
export function canAccessDepartment(user, dept) {
  if (isPM(user)) return true;
  if (isHead(user)) return headDepartments(user).includes(dept);
  return false;
}

// Stricter than canAccessDepartment: a PM does NOT pass. For surfaces that belong to a
// department's own people rather than to oversight — a PM has no business on the Production
// worker sheet. PMs have a null departments column, so this is false for them by construction.
export function inDepartment(user, dept) {
  return headDepartments(user).includes(dept);
}

// A customer may only open their own project(s); every internal role passes (scoped elsewhere).
export function canAccessProject(user, projectId) {
  if (!isCustomer(user)) return true;
  return parseProjectIds(user.project_ids ?? user.project_id).includes(String(projectId));
}

// Approval hierarchy for pending self-registrations: admin/executive approve anyone; a manager
// (PM tier below executive) approves department heads and customers, not other PMs or admins.
export function canApproveUser(approver, target) {
  if (!isInternal(approver)) return false;
  if (['admin', 'executive'].includes(approver.role)) return true;
  if (approver.role === 'manager') return ['operator', 'customer'].includes(target?.role);
  return false;
}

// Route-handler guards — return an error Response when the check fails, else null.
export function requirePM(user) {
  if (isPM(user)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
export function requireDepartment(user, dept) {
  if (canAccessDepartment(user, dept)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// Where a role belongs after login / when it hits a page it may not see.
export function roleHome(user) {
  if (!user) return '/login';
  if (isCustomer(user)) return '/portal'; // "My Orders" — even a single-project customer lands here
  // Home is the common landing page for every internal role. Department and role workspaces are
  // navigation tabs, not login destinations; this keeps liaison users oriented after access changes.
  return '/';
}

// Where POST /api/login sends you. Customers keep their portal; every internal role lands on Home.
export function postLoginHome(user) {
  if (isCustomer(user)) return '/portal';
  return '/';
}
