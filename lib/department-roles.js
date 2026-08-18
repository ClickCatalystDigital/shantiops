// lib/department-roles.js — display labels for the two-tier department Responsibility model
// (users.department_roles, an existing generic {dept: 'head'|'designer'} JSON column — see
// lib/db.js's users table comment). The stored value is deliberately uniform across every
// department ('head' or 'designer' — 'designer' is already lib/auth.js's department-agnostic
// fallback token for the non-head tier, not literally Design-specific, so it's kept as-is rather
// than renamed and migrated). This keeps every generic gating check (isDepartmentHead,
// hasActiveDepartmentResponsibility in lib/auth.js) a one-liner regardless of department — only
// the label shown in the UI is department-flavored.
//
// Design and Engineering previously had this as two hardcoded <select> blocks with their own
// literal option labels; this generalizes that pattern to every department in DEPARTMENTS
// (lib/milestones.js) instead of only those two.
export const RESPONSIBILITY_LABELS = {
  Design:       { head: 'Design Head',       designer: 'Designer' },
  Engineering:  { head: 'Engineering Head',  designer: 'Engineer' },
  Procurement:  { head: 'Procurement Head',  designer: 'Buyer' },
  Stores:       { head: 'Stores Head',       designer: 'Storekeeper' },
  Production:   { head: 'Production Head',   designer: 'Supervisor' },
  QC:           { head: 'QC Head',           designer: 'Inspector' },
  Dispatch:     { head: 'Dispatch Head',     designer: 'Dispatch Executive' },
  Installation: { head: 'Installation Head', designer: 'Site Engineer' },
  Sales:        { head: 'Sales Head',        designer: 'Sales Executive' },
  Marketing:    { head: 'Marketing Head',    designer: 'Marketing Executive' },
  HR:           { head: 'HR Head',           designer: 'HR Executive' },
};

// The only two values department_roles ever stores, for every department. Kept here (not
// hand-typed at each validation/render site) so a future third tier is one change, not a grep.
export const RESPONSIBILITY_VALUES = ['head', 'designer'];

export function responsibilityLabel(dept, value) {
  return RESPONSIBILITY_LABELS[dept]?.[value] || (value === 'head' ? `${dept} Head` : value);
}
