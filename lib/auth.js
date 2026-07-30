// lib/auth.js
import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';
const COOKIE_NAME = 'token';

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
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Departments are stored as a CSV string on the user row; the token/UI want an array.
export function parseDepartments(csv) {
  if (Array.isArray(csv)) return csv;
  if (!csv) return [];
  return String(csv).split(',').map(s => s.trim()).filter(Boolean);
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
    return jwt.verify(token, JWT_SECRET);
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
  return jwt.sign({ role: 'agent', machine_id: machineId }, JWT_SECRET, { expiresIn: '365d' });
}

export const COOKIE_OPTS = {
  name: COOKIE_NAME,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60
};

export const APPROVER_ROLES = ['admin', 'manager', 'executive'];
export function isApprover(user) {
  return !!user && APPROVER_ROLES.includes(user.role);
}

// Role tiers. Internal = runs the factory; external = the customer who placed the order.
export function isCustomer(user) { return user?.role === 'customer'; }
// Machine tokens (USB agents) must never pass as a human session — excluded from isInternal.
export function isAgent(user) { return user?.role === 'agent'; }
export function isInternal(user) { return !!user && !isCustomer(user) && !isAgent(user); }
// executive: full PM powers + sits above PM in the approval hierarchy (see canApproveUser).
export function isManager(user) { return !!user && ['admin', 'manager', 'executive'].includes(user.role); } // sees Executive

// Redesign role model: admin/manager collapse into "PM"; operator becomes "Functional Head".
export function isPM(user) { return isManager(user); }
export function isHead(user) { return user?.role === 'operator'; }
export function headDepartments(user) { return parseDepartments(user?.departments); }

// Demo-only escape hatch: named accounts skip the device-setup gate (app/layout.js) so a
// walkthrough never gets stuck on "your machine isn't registered yet". ponytail: env
// allowlist, not a DB column — unset DEMO_USERS to remove it entirely.
const DEMO_USERS = (process.env.DEMO_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
export function isDemoUser(user) { return !!user && DEMO_USERS.includes(user.username); }

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
  if (isCustomer(user)) return '/portal'; // "My Orders" — even a single-project customer lands here
  if (isPM(user)) return '/executive'; // PM lands strategic-first
  // Production runs its day off the calendar, so that's their landing tab. No redirect loop:
  // /production only bounces users who are NOT in Production, and for those this never returns it.
  if (inDepartment(user, 'Production')) return '/production';
  return '/';
}

// Where POST /api/login sends you. Deliberately not roleHome(): that also routes PMs to
// /executive, but login has always landed them on '/' and moving it isn't part of this change.
// Only Production gains a landing tab here; everyone else keeps today's behaviour exactly.
export function postLoginHome(user) {
  if (isCustomer(user)) return '/portal';
  if (inDepartment(user, 'Production')) return '/production';
  return '/';
}
