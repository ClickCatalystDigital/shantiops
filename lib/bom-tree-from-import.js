// lib/bom-tree-from-import.js — auto-builds the bom_assemblies tree from a fresh PMB/CSV import's
// own section/group_label data (SYSTEM.md §5au's tree exists, but the parser never fed it — this
// closes that gap without touching the parser itself). Called from inside
// app/api/projects/[id]/bom/import/route.js's own transaction, right after the item-insert loop.
//
// Algorithm (validated against real production data, see the plan this was built from):
//   - One top-level ("System") node per distinct `section` (the Excel sheet name).
//   - If a section has more than one distinct heading (`group_label`, or a catalog item's
//     `group_name` as a fallback when group_label is null), each gets its own ("Subsystem") child
//     node; an item with neither attaches directly to the System node.
//   - If a section has at most one distinct heading, skip the Subsystem layer — everything attaches
//     directly to the System node (mirrors a real hand-built tree's own convention exactly).
//   - A CSV import's generic default sheet name ("Sheet1") never becomes a real node — headings (if
//     any) become top-level nodes directly instead of sitting under a meaningless wrapper.
// Find-or-create is case-insensitive and scoped to this one import's still-unassigned rows, so
// re-running it (a Replace, or a second call) is always safe: never creates a duplicate node for an
// already-existing name (however it was cased or however it was created), never touches an item a
// human has already placed by hand.
import { humanizeAssemblyName } from './bom-structure.mjs';

const GENERIC_SHEET_NAME = /^sheet\s*\d*$/i;

async function findOrCreateAssembly(tx, projectId, parentId, name, nodeType, username) {
  const existing = await tx.execute({
    sql: parentId == null
      ? 'SELECT id FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL AND LOWER(name) = LOWER(?)'
      : 'SELECT id FROM bom_assemblies WHERE project_id = ? AND parent_id = ? AND LOWER(name) = LOWER(?)',
    args: parentId == null ? [projectId, name] : [projectId, parentId, name],
  });
  if (existing.rows.length) return { id: Number(existing.rows[0].id), created: false };

  const siblingMax = await tx.execute({
    sql: parentId == null
      ? 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id IS NULL'
      : 'SELECT MAX(sort_order) AS m FROM bom_assemblies WHERE project_id = ? AND parent_id = ?',
    args: parentId == null ? [projectId] : [projectId, parentId],
  });
  const sortOrder = (siblingMax.rows[0]?.m ?? -1) + 1;

  const inserted = await tx.execute({
    sql: `INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, created_by)
          VALUES (?, ?, ?, 1, ?, ?, ?)`,
    args: [projectId, parentId, name, sortOrder, nodeType, username],
  });
  return { id: Number(inserted.lastInsertRowid), created: true };
}

export async function buildAssemblyTreeFromImport({ tx, projectId, importId, username }) {
  const res = await tx.execute({
    sql: `SELECT bi.id, bi.section, bi.group_label, it.group_name
          FROM bom_items bi LEFT JOIN items it ON it.id = bi.item_id
          WHERE bi.import_id = ? AND bi.assembly_id IS NULL`,
    args: [importId],
  });
  const rows = res.rows;
  if (!rows.length) return { nodesCreated: 0, nodesReused: 0, itemsAssigned: 0 };

  const effectiveLabel = (row) => (row.group_label ? String(row.group_label).trim() : null)
    || (row.group_name ? String(row.group_name).trim() : null)
    || null;

  const bySection = new Map();
  for (const row of rows) {
    const section = String(row.section || '').trim();
    if (!section) continue; // defensive — the parser always sets section on every real row
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push(row);
  }

  let nodesCreated = 0, nodesReused = 0, itemsAssigned = 0;
  const assignments = new Map(); // assemblyId -> itemId[]
  const queueAssign = (assemblyId, itemId) => {
    if (!assignments.has(assemblyId)) assignments.set(assemblyId, []);
    assignments.get(assemblyId).push(itemId);
  };
  const record = (created) => { created ? nodesCreated++ : nodesReused++; };

  for (const [section, sectionRows] of bySection) {
    const isGeneric = GENERIC_SHEET_NAME.test(section);

    const labelGroups = new Map(); // label -> row[]
    const unlabeled = [];
    for (const row of sectionRows) {
      const label = effectiveLabel(row);
      if (label) {
        if (!labelGroups.has(label)) labelGroups.set(label, []);
        labelGroups.get(label).push(row);
      } else {
        unlabeled.push(row);
      }
    }

    let systemNodeId = null;
    let hasExistingChildren = false;
    if (!isGeneric) {
      const node = await findOrCreateAssembly(tx, projectId, null, humanizeAssemblyName(section), 'System', username);
      systemNodeId = node.id;
      record(node.created);
      // A later import into the same section (a Replace, or a real bom_item surviving Replace
      // because it has downstream activity — lib/bom-item-guard.js) must not flatten a single new
      // label onto the System node when a real Subsystem layer already exists there from an
      // earlier import — that would split one real heading across two different homes (an existing
      // Subsystem child, and a stray item sitting bare at the System level). Once any Subsystem
      // child exists, always go 2-level, regardless of how many labels *this one batch* carries.
      const childCount = await tx.execute({
        sql: 'SELECT COUNT(*) AS c FROM bom_assemblies WHERE parent_id = ?',
        args: [systemNodeId],
      });
      hasExistingChildren = Number(childCount.rows[0]?.c ?? 0) > 0;
    }

    if (labelGroups.size > 1 || (labelGroups.size === 1 && hasExistingChildren)) {
      // Multiple real headings in this section — each gets its own child node. For a generic CSV
      // sheet with no System wrapper, these become top-level nodes directly instead.
      for (const [label, labelRows] of labelGroups) {
        const parentId = isGeneric ? null : systemNodeId;
        const nodeType = parentId == null ? 'System' : 'Subsystem';
        const node = await findOrCreateAssembly(tx, projectId, parentId, humanizeAssemblyName(label), nodeType, username);
        record(node.created);
        for (const row of labelRows) queueAssign(node.id, row.id);
      }
      // Unlabeled rows in a real (non-generic) section attach directly to the System node — a
      // generic section has no wrapper to attach them to, so they stay unassigned.
      if (!isGeneric) for (const row of unlabeled) queueAssign(systemNodeId, row.id);
    } else if (labelGroups.size === 1) {
      // Exactly one heading, and no Subsystem layer already exists here — flatten: skip it,
      // matching a real hand-built tree's own convention (a single-heading section attaches
      // directly to its System node).
      const [[, labelRows]] = labelGroups;
      if (isGeneric) {
        const [[label]] = labelGroups;
        const node = await findOrCreateAssembly(tx, projectId, null, humanizeAssemblyName(label), 'System', username);
        record(node.created);
        for (const row of labelRows) queueAssign(node.id, row.id);
        // unlabeled rows in a generic section with one heading have no wrapper — left unassigned.
      } else {
        for (const row of labelRows) queueAssign(systemNodeId, row.id);
        for (const row of unlabeled) queueAssign(systemNodeId, row.id);
      }
    } else if (!isGeneric) {
      // No headings at all in a real section — every item attaches directly to the System node.
      for (const row of unlabeled) queueAssign(systemNodeId, row.id);
    }
    // A generic section with zero headings has no signal at all to build from — left unassigned.
  }

  for (const [assemblyId, itemIds] of assignments) {
    for (const itemId of itemIds) {
      await tx.execute({ sql: 'UPDATE bom_items SET assembly_id = ? WHERE id = ?', args: [assemblyId, itemId] });
      itemsAssigned++;
    }
  }

  return { nodesCreated, nodesReused, itemsAssigned };
}
