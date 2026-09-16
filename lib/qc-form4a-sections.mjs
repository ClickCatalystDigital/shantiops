// Pure, dependency-free manual-group section resolution for Form IV A's lettered material grouping.
// Groups are QC-created via the UI (qc_form4a_groups) and assigned per-part (qc_document_parts.
// form4a_group_id) — a deliberate manual mechanism, not derived from the BOM tree. An earlier
// version auto-derived sections by walking bom_assemblies, which regularly left a meaningless
// "Ungrouped Materials" catch-all and sometimes labeled a section with a BOM-tree node name that
// wasn't real government-form wording (e.g. "Boiler Shell & Body") — replaced outright, per direct
// instruction, with this manual, QC-driven mechanism.
//
// A document with zero groups produces zero sections and every part in the flat `ungrouped` bucket
// — the caller (lib/qc-folder-pdf.js) renders that as one plain table with no section heading at
// all, never printing "Ungrouped Materials" or any other synthetic label.

function letterFor(i) { return i < 26 ? String.fromCharCode(65 + i) : String(i + 1); }

// Groups `parts` (each carrying its own `.form4a_group_id`) into lettered sections, in the groups'
// own sort_order, plus a trailing ungrouped bucket. Only a group with >=1 assigned part gets a
// letter — an empty group (created but nothing assigned to it yet) is silently skipped, never
// printed as an empty section.
export function buildManualSections(groups, parts) {
  const byGroupId = new Map();
  const ungrouped = [];
  for (const p of parts) {
    if (p.form4a_group_id == null) { ungrouped.push(p); continue; }
    if (!byGroupId.has(p.form4a_group_id)) byGroupId.set(p.form4a_group_id, []);
    byGroupId.get(p.form4a_group_id).push(p);
  }
  const ordered = [...groups].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  const withParts = ordered.filter(g => byGroupId.has(g.id));
  const sections = withParts.map((g, i) => ({ letter: letterFor(i), name: g.name, parts: byGroupId.get(g.id) }));
  return { sections, ungrouped };
}
