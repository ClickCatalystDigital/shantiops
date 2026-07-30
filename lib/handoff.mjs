// lib/handoff.mjs — the milestone→milestone handoff rule. Pure, no imports: safe for client
// components and for plain `node --test` (.mjs because the repo has no "type":"module" —
// same reason as lib/bom-fields.mjs).

// The next milestone after `m` in that project's chain. sort_order IS the sequence (it's the
// MILESTONE_TEMPLATE array index and never changes), but it's only NOT NULL DEFAULT 0 in the
// schema, so tie-break on id rather than trust uniqueness on hand-edited data.
export function nextBySortOrder(rows, m) {
  return rows
    .filter(r => r.sort_order > m.sort_order || (r.sort_order === m.sort_order && r.id > m.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)[0] || null;
}

// Who a just-closed milestone hands off to, or null if nobody.
//
// `rows` MUST be that project's own milestone rows, never MILESTONE_TEMPLATE: milestones.department
// is a per-row column in the PATCH route's EDITABLE list, so a PM can re-assign it per project.
// And there is no static department order to walk — the template runs Production(9-18) → QC(19) →
// Production(20-21), so "next department" is not monotonic. The chain is the only source of truth.
//
// Same-department next row → null. That's the point: a handoff fires only on the LAST milestone of
// a department run, which is what yields exactly the 6 boundaries in the default template.
export function handoffTarget(rows, m) {
  if (!m?.department) return null;              // PM blanked the department — can't say who's handing off
  const next = nextBySortOrder(rows, m);
  if (!next?.department) return null;           // last milestone of the project, or next row has no department
  if (next.department === m.department) return null;
  return next;
}
