// lib/data.js — server-side read helpers shared by the page components.
import { queryAll, queryOne } from './db';
import { effectiveStatus, worstStatus, biggestBlocker, slaStatus } from './sla';
import { cumulativeDelay } from './delay';
import { CUSTOMER_PHASES } from './milestones';
import { headDepartments, isPM } from './auth';
import { effectiveStatus as usbEffectiveStatus } from './usb';
import { isOpenStatus, isClosedStatus, DEFAULT_PURCHASE_STATUS, PURCHASE_STATUSES } from './bom-fields.mjs';
import { runValidations } from './calc-engine';
import { getCalcDrawings } from './calc';

const ATTENTION = new Set(['overdue', 'blocked', 'due_now', 'due_soon', 'in_progress']);

export async function getProjectsWithStatus() {
  // V2-CHANGES.md Group 6 Phase 6.4 — is_system excludes the sentinel project (`—NON-PROJECT—`)
  // that source='stock'/'sas' bom_items point at in place of a real project_id (which stays
  // NOT NULL at the DB level). Every other project query already filters WHERE status='active',
  // which the sentinel's status='system' fails on its own; this is the one query that doesn't.
  const projects = await queryAll('SELECT * FROM projects WHERE is_system = 0 ORDER BY created_at DESC');
  const miles = await queryAll('SELECT * FROM milestones');

  const byProject = {};
  miles.forEach(m => { (byProject[m.project_id] ||= []).push(m); });

  return projects.map(p => {
    const ms = byProject[p.id] || [];
    const done = ms.filter(m => m.actual_end || m.status === 'done').length;
    return {
      ...p,
      roll: worstStatus(ms),
      blocker: biggestBlocker(ms),
      progress: ms.length ? Math.round((done / ms.length) * 100) : 0,
      milestones: ms,
    };
  });
}

// "N projects currently stuck at Shell Welding" — one department's per-stage bottleneck view.
// A project's blocker (biggestBlocker) is its single worst open milestone project-wide; counted
// here only when that milestone sits in `department`, so a project appears at exactly one stage.
export async function getStageBottlenecks(department) {
  const projects = await getProjectsWithStatus();
  const counts = {};
  for (const p of projects) {
    if (p.blocker && p.blocker.department === department) {
      counts[p.blocker.milestone_label] = (counts[p.blocker.milestone_label] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// "Waiting on" — one department's currently-active milestones (same ATTENTION set as
// getMyWork — overdue/blocked/due_now/due_soon/in_progress) without material ready, grouped by
// why (delay_category — the drawer's existing "If delayed" field, no new schema). Scoped to
// ATTENTION, not just "material_ready = 0": that flag defaults to false for every milestone that
// simply hasn't started yet, so an unscoped query would surface the whole future backlog as
// "waiting" instead of what's actually stuck right now.
export async function getWaitingList(department) {
  const rows = await queryAll(
    `SELECT m.*, p.project_no, p.customer_name
       FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.department = ? AND m.material_ready = 0`,
    [department]
  );
  const groups = {};
  for (const m of rows) {
    if (!ATTENTION.has(effectiveStatus(m).code)) continue;
    (groups[m.delay_category || 'Uncategorized'] ||= []).push(m);
  }
  return groups;
}

export async function getProjectDetail(id) {
  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return null;
  const milestones = await queryAll(
    'SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order, id', [id]
  );

  const done = milestones.filter(m => m.actual_end || m.status === 'done').length;
  const scheduled = milestones.filter(m => m.planned_end);
  const current = milestones.find(m => effectiveStatus(m).code === 'in_progress');
  const next = milestones.find(m => !m.actual_end && m.status !== 'done' && m.planned_end);
  const estDispatch = scheduled.reduce((a, m) => (m.planned_end > a ? m.planned_end : a), '');

  return {
    project,
    milestones,
    health: worstStatus(milestones),
    blocker: biggestBlocker(milestones),
    progress: milestones.length ? Math.round((done / milestones.length) * 100) : 0,
    currentPhase: current?.milestone_label || null,
    nextPhase: next?.milestone_label || null,
    estDispatch: estDispatch || null,
  };
}

// "My Work" (functional head, department-scoped) / "Today's Factory" (PM, everything).
// deptFilter narrows further — a PM peeking at one department (Departments dropdown), or a head
// with multiple departments picking one of their own tabs.
export async function getMyWork(user, deptFilter = null) {
  const rows = await queryAll(
    `SELECT m.*, p.project_no, p.customer_name
       FROM milestones m
       JOIN projects p ON p.id = m.project_id`
  );
  let scoped = user?.role === 'operator'
    ? rows.filter(r => headDepartments(user).includes(r.department))
    : rows;
  if (deptFilter) scoped = scoped.filter(r => r.department === deptFilter);
  const items = scoped
    .map(m => ({ ...m, eff: effectiveStatus(m) }))
    .filter(m => ATTENTION.has(m.eff.code));

  // Group by project, sort each by urgency (severity via daysLeft ascending is a fine proxy).
  const byProject = {};
  for (const it of items) {
    (byProject[it.project_id] ||= { project_no: it.project_no, customer_name: it.customer_name, items: [] })
      .items.push(it);
  }
  const order = { overdue: 0, blocked: 1, due_now: 2, due_soon: 3, in_progress: 4 };
  Object.values(byProject).forEach(g => g.items.sort((a, b) => order[a.eff.code] - order[b.eff.code]));
  return Object.values(byProject);
}

export async function getExecutiveSummary() {
  const projects = await getProjectsWithStatus();
  const bomByProject = await getBomRollupAll();

  const kpi = { total: projects.length, healthy: 0, delayed: 0, critical: 0, completed: 0, valueInProgress: 0 };
  for (const p of projects) {
    const c = p.roll.code;
    if (c === 'done') kpi.completed++;
    else if (c === 'overdue' || c === 'blocked') kpi.critical++;
    else if (c === 'due_now' || c === 'due_soon') kpi.delayed++;
    else kpi.healthy++;
    if (c !== 'done') kpi.valueInProgress += p.order_value || 0;
  }

  // Average delay = mean overdue days across currently-overdue milestones.
  const allMiles = projects.flatMap(p => p.milestones);
  const overdue = allMiles.map(m => slaStatus(m)).filter(s => s.code === 'red');
  kpi.avgDelay = overdue.length ? Math.round(overdue.reduce((a, s) => a + Math.abs(s.daysLeft), 0) / overdue.length) : 0;

  // Delayed because — count open, at-risk milestones by delay category.
  const delayedBy = {};
  for (const m of allMiles) {
    const code = effectiveStatus(m).code;
    if ((code === 'overdue' || code === 'blocked') && m.delay_category) {
      delayedBy[m.delay_category] = (delayedBy[m.delay_category] || 0) + 1;
    }
  }

  const topRisks = projects
    .filter(p => p.blocker)
    .map(p => ({ project_no: p.project_no, id: p.id, customer_name: p.customer_name, ...p.blocker }))
    .sort((a, b) => b.impactDays - a.impactDays);

  const forecast = projects.map(p => {
    const est = p.milestones.reduce((a, m) => (m.planned_end && m.planned_end > a ? m.planned_end : a), '');
    const current = p.milestones.find(m => effectiveStatus(m).code === 'in_progress');
    const next = p.milestones.find(m => !m.actual_end && m.status !== 'done' && m.planned_end);
    return {
      id: p.id, project_no: p.project_no, customer_name: p.customer_name, roll: p.roll,
      estDispatch: est || null,
      progress: p.progress,
      currentStage: current?.milestone_label || next?.milestone_label || '—',
      cumDelay: cumulativeDelay(p.milestones),
      value: p.order_value,
      bom: bomByProject[p.id] || null,
    };
  });

  return { kpi, delayedBy, topRisks, forecast };
}

// Read-only customer view: collapse internal milestones into business-language phases.
export async function getCustomerView(projectId) {
  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;
  const milestones = await queryAll('SELECT * FROM milestones WHERE project_id = ?', [projectId]);
  const byKey = {};
  milestones.forEach(m => { (byKey[m.milestone_key] ||= []).push(m); });

  const phases = CUSTOMER_PHASES.map((ph, i) => {
    const ms = ph.keys.flatMap(k => byKey[k] || []);
    let status = 'upcoming';
    if (i === 0) status = 'done'; // Order Received — implicit once the project exists
    else if (ms.length) {
      const doneCount = ms.filter(m => m.actual_end || m.status === 'done').length;
      const started = ms.some(m => m.actual_start || m.status === 'in_progress' || m.actual_end || m.status === 'done');
      if (doneCount === ms.length) status = 'done';
      else if (started) status = 'in_progress';
    }
    return { key: ph.key, label: ph.label, status };
  });

  const estDispatch = milestones.reduce((a, m) => (m.planned_end && m.planned_end > a ? m.planned_end : a), '');
  const packing = await queryOne(
    "SELECT id FROM packing_lists WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [projectId]
  );
  return { project, phases, estDispatch: estDispatch || null, packingListId: packing?.id || null };
}

export async function getPackingLists() {
  return queryAll(
    `SELECT pl.*, (SELECT COUNT(*) FROM packing_items WHERE packing_list_id = pl.id) AS item_count
       FROM packing_lists pl ORDER BY pl.created_at DESC`
  );
}

// This project's packing lists — for the Dispatch panel on the project page.
export async function getProjectPackingLists(projectId) {
  return queryAll(
    `SELECT pl.*, (SELECT COUNT(*) FROM packing_items WHERE packing_list_id = pl.id) AS item_count
       FROM packing_lists pl WHERE pl.project_id = ? ORDER BY pl.created_at DESC`, [projectId]
  );
}

// This project's QC test/inspection records — for the QC panel on the project page.
export async function getQcRecords(projectId) {
  return queryAll('SELECT * FROM qc_records WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
}

// QC V1 (QC-CHANGES.md) — Test Certificate bank + statutory documents. --------------------------

// The whole bank, small at this company's scale (17 seeded) — same "fetch flat, filter client-side"
// idiom as getSuppliers/getAllQuotes, with a linked-part count so the /qc list can show reuse
// ("used in N parts") without a second round trip per row.
export async function getTestCertificates() {
  return queryAll(
    `SELECT tc.*, (SELECT COUNT(*) FROM qc_document_parts WHERE test_certificate_id = tc.id) AS used_in_parts
       FROM test_certificates tc ORDER BY tc.created_at DESC`);
}

export async function getTestCertificate(id) {
  return queryOne('SELECT * FROM test_certificates WHERE id = ?', [id]);
}

// This project's statutory documents, with a linked/total part count for the Statutory Documents
// panel's "44 of 54 parts linked" line.
export async function getQcDocuments(projectId) {
  return queryAll(
    `SELECT d.*,
            (SELECT COUNT(*) FROM qc_document_parts WHERE document_id = d.id) AS total_parts,
            (SELECT COUNT(*) FROM qc_document_parts WHERE document_id = d.id AND test_certificate_id IS NOT NULL) AS linked_parts
       FROM qc_documents d WHERE d.project_id = ? ORDER BY d.created_at DESC`, [projectId]);
}

// One document's full editor payload: header fields + every part row, each carrying its linked
// certificate's fields inline (or all-NULL if unlinked) — the "display-only, fetched from the TC"
// columns the document editor renders, per the QC V1 plan's hard rule that these are never inputs.
export async function getQcDocumentDetail(id) {
  const document = await queryOne('SELECT * FROM qc_documents WHERE id = ?', [id]);
  if (!document) return null;
  const parts = await queryAll(
    `SELECT p.*, tc.certificate_no, tc.cast_no AS tc_cast_no, tc.plate_no AS tc_plate_no,
            tc.material_spec, tc.steel_maker, tc.chem_c, tc.chem_mn, tc.chem_p, tc.chem_s, tc.chem_si,
            tc.ys, tc.uts, tc.elongation, tc.bend_test
       FROM qc_document_parts p LEFT JOIN test_certificates tc ON tc.id = p.test_certificate_id
      WHERE p.document_id = ? ORDER BY p.sort_order, p.id`, [id]);
  return { document, parts };
}

export async function getPackingDetail(id) {
  const list = await queryOne('SELECT * FROM packing_lists WHERE id = ?', [id]);
  if (!list) return null;
  const items = await queryAll(
    'SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY box_no, s_no, id', [id]
  );
  return { list, items };
}

// Functional heads — for the PM's access matrix / user management screen (Settings).
export async function getFunctionalHeads() {
  const rows = await queryAll(
    "SELECT id, username, display_name, departments, active, safe_pass FROM users WHERE role = 'operator' AND pending = 0 ORDER BY username"
  );
  return rows.map(r => ({ ...r, departments: headDepartments(r) }));
}

// Device-setup gate (root layout, functional heads only) — the machine admin/executive already
// registered for this person, if any. "Set up" means enrolled_at OR last_seen: enrolled_at only
// gets stamped by the zero-typing code-redemption path (app/api/agent/enroll), so an older machine
// enrolled via the manual-token fallback has last_seen/agent_version but no enrolled_at — still a
// real, working machine. Prefers a set-up machine over a stale unset one if the person has more
// than one row (e.g. a replaced device).
export async function getMyMachine(userId) {
  return queryOne(
    `SELECT id, name, enrolled_at, last_seen, active FROM machines WHERE user_id = ?
     ORDER BY (enrolled_at IS NOT NULL OR last_seen IS NOT NULL) DESC, id DESC LIMIT 1`,
    [userId]
  );
}

// Approvals → People tab: pending self-registrations + an onboarding roster (person + machine
// status) — closes the "employee roster" gap noted in SYSTEM.md §13 (only enrolled machines were
// visible before; now every internal person shows, with a derived status even before enrollment).
export async function getPeopleDashboard() {
  const pendingRows = await queryAll(
    "SELECT id, username, display_name, role, departments, created_at FROM users WHERE pending = 1 ORDER BY created_at"
  );
  const pending = pendingRows.map(r => ({ ...r, departments: headDepartments(r) }));
  const rows = await queryAll(
    `SELECT u.id AS user_id, u.username, u.display_name, u.role, u.departments,
            m.id AS machine_id, m.name AS machine_name, m.agent_version, m.enrolled_at, m.last_seen, m.active AS machine_active
       FROM users u LEFT JOIN machines m ON m.user_id = u.id
      WHERE u.role IN ('operator','manager','admin','executive') AND u.active = 1 AND u.pending = 0
      ORDER BY u.username, m.id`
  );
  const byUser = {};
  for (const r of rows) {
    const u = (byUser[r.user_id] ||= {
      id: r.user_id, username: r.username, display_name: r.display_name,
      role: r.role, departments: headDepartments(r), machines: [],
    });
    if (r.machine_id) u.machines.push({
      id: r.machine_id, name: r.machine_name, agent_version: r.agent_version,
      enrolled_at: r.enrolled_at, last_seen: r.last_seen, active: r.machine_active,
    });
  }
  const roster = Object.values(byUser).map(u => {
    const online = u.machines.some(m => m.last_seen && Date.now() - Date.parse(m.last_seen.replace(' ', 'T') + 'Z') < 30_000);
    const enrolled = u.machines.some(m => m.enrolled_at || m.last_seen);
    const status = online ? 'online' : enrolled ? 'enrolled' : u.machines.length ? 'enroll_sent' : 'no_machine';
    return { ...u, status };
  });
  return { pending, roster };
}

// BOM + reconciliation for a project. Pending = BOM lines not yet carried into an approved
// (non-draft) packing list, so partial dispatches can seed a new list later (§8).
export async function getProjectBom(projectId) {
  // selected_supplier_name/selected_unit_price are derived from selected_quote_id (§ Procurement
  // system) — NULL until a head picks a winning quote via POST /api/bom-items/[id]/select-supplier.
  const bom = await queryAll(
    `SELECT b.*, s.name AS selected_supplier_name, sq.unit_price AS selected_unit_price
       FROM bom_items b
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
       LEFT JOIN suppliers s ON s.id = sq.supplier_id
      WHERE b.project_id = ? ORDER BY b.sort_order, b.id`, [projectId]);
  // A BOM line is "carried" once it's referenced by a packing item on a packed/dispatched list.
  const carried = await queryAll(
    `SELECT DISTINCT pi.bom_item_id FROM packing_items pi
       JOIN packing_lists pl ON pl.id = pi.packing_list_id
      WHERE pl.project_id = ? AND pl.status != 'draft' AND pi.bom_item_id IS NOT NULL`, [projectId]
  );
  const carriedIds = new Set(carried.map(r => r.bom_item_id));
  // Import/revision history (no blob — that streams via /api/bom-imports/[id]/file).
  const imports = await queryAll(
    `SELECT id, filename, revision, imported_by, created_at
       FROM bom_imports WHERE project_id = ? ORDER BY revision DESC`, [projectId]);
  return { bom, pending: bom.filter(b => !carriedIds.has(b.id)), imports };
}

// Per-section BOM procurement rollup for one project. closed = Received, Cancelled, or In-Stock
// (resolved either way — a cancelled item isn't open work, even though it wasn't delivered);
// everything else (incl. no status yet) counts as pending. transit shown separately.
export async function getBomRollup(projectId) {
  const rows = await queryAll(
    `SELECT COALESCE(section, 'BOM') AS section, purchase_status, COUNT(*) AS n
       FROM bom_items WHERE project_id = ? GROUP BY section, purchase_status`, [projectId]);
  const bySection = {};
  for (const r of rows) {
    const s = (bySection[r.section] ||= { section: r.section, total: 0, closed: 0, transit: 0, pending: 0 });
    s.total += r.n;
    if (isClosedStatus(r.purchase_status)) s.closed += r.n;
    else if (r.purchase_status === 'Transit') s.transit += r.n;
    else s.pending += r.n;
  }
  const sections = Object.values(bySection);
  const total = sections.reduce((a, s) => a + s.total, 0);
  const closed = sections.reduce((a, s) => a + s.closed, 0);
  return { sections, total, closed, closedPct: total ? Math.round((closed / total) * 100) : 0 };
}

// BOM closed-% per project, for the Executive forecast table. { projectId: {total, closedPct} }.
export async function getBomRollupAll() {
  const rows = await queryAll(
    `SELECT project_id,
            COUNT(*) AS total,
            SUM(CASE WHEN purchase_status IN ('Received','Cancelled','In-Stock') THEN 1 ELSE 0 END) AS closed
       FROM bom_items GROUP BY project_id`);
  const out = {};
  for (const r of rows) {
    out[r.project_id] = { total: r.total, closedPct: r.total ? Math.round((r.closed / r.total) * 100) : 0 };
  }
  return out;
}

// D4 stage label for whichever lowercase key deriveActiveStage returns — used only for the three
// "still moving" stages; Cancelled/Received/In-Stock are handled directly off purchase_status
// before deriveActiveStage is ever called, same order getProcurementFlowCounts uses.
const ACTIVE_STAGE_LABEL = { enquiry: 'Enquiry', comparison: 'Comparison', ordered: 'Ordered', transit: 'Transit' };

export async function getBomWork(user) {
  const depts = isPM(user)
    ? ['Engineering', 'Procurement', 'Stores', 'Production']
    : headDepartments(user).filter(d => ['Engineering', 'Procurement', 'Stores', 'Production'].includes(d));
  if (!depts.length) return [];

  // Flat per-item rows, not a GROUP BY aggregate — bucketing needs deriveActiveStage's extra
  // signals (selected_quote_id, po_ref, quote_count), not just the raw purchase_status column.
  // V2-CHANGES.md Group 5 Phase 5.0b: purchase_status isn't kept live by quote-logging or
  // supplier-selection (only PO issue/unissue, cancel, and a manual override move it), so a plain
  // GROUP BY on the column undercounts Ordered — the same bug that phase already found and fixed
  // in getProcurementFlowCounts, just not carried over here at the time. Reusing deriveActiveStage
  // (defined below, used by getProcurementFlowCounts) rather than re-deriving the same signals a
  // second way keeps the two cards unable to drift apart again.
  const rows = await queryAll(
    `SELECT p.id AS project_id, p.project_no, p.customer_name,
            b.id AS bom_item_id, b.purchase_status, b.po_ref, b.selected_quote_id,
            (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count
       FROM projects p LEFT JOIN bom_items b ON b.project_id = p.id
      WHERE p.status = 'active'
      ORDER BY p.created_at DESC`);

  const byProject = {};
  for (const r of rows) {
    const p = (byProject[r.project_id] ||= {
      id: r.project_id, project_no: r.project_no, customer_name: r.customer_name,
      total: 0, closed: 0, stages: Object.fromEntries(PURCHASE_STATUSES.map(s => [s, 0])),
    });
    if (!r.bom_item_id) continue; // LEFT JOIN's "no bom_items at all" row for this project

    let status;
    if (r.purchase_status === 'Cancelled') status = 'Cancelled';
    else if (r.purchase_status === 'Received') status = 'Received';
    else if (r.purchase_status === 'In-Stock') status = 'In-Stock';
    else status = ACTIVE_STAGE_LABEL[deriveActiveStage(r)];

    p.stages[status]++;
    p.total++;
    if (isClosedStatus(status)) p.closed++;
  }

  return Object.values(byProject)
    .map(p => ({ ...p, open: p.total - p.closed }))
    .filter(p => (p.total === 0 ? depts.includes('Engineering') : p.open > 0));
}

// Procurement system (§5a) — the /procurement workspace's data. Every BOM item across every
// active project, cross-project on purpose: the same MS angle gets bought once for several
// boilers, not per project, so Procurement's real worklist can't be scoped to one project the way
// ProcurementQueue.jsx (the project-page glance) is. Fuzzy "same item on other projects" grouping
// is deliberately done client-side from this flat list, not here — these are hand-typed spreadsheet
// rows (SB-1104 alone has two different rows both called "MS ANGLE"), so it's a suggestion a human
// confirms, never a merge a query performs.
export async function getSourcingItems() {
  return queryAll(
    `SELECT b.*, p.project_no, p.customer_name, p.is_system AS project_is_system,
            s.name AS selected_supplier_name, sq.unit_price AS selected_unit_price,
            pr.pr_no, pr.created_at AS pr_created_at
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
       LEFT JOIN suppliers s ON s.id = sq.supplier_id
       LEFT JOIN pr_items pi ON pi.id = b.pr_item_id
       LEFT JOIN purchase_requisitions pr ON pr.id = pi.pr_id
      -- V2-CHANGES.md Group 6 Phase 6.4 (D7) — source='stock'/'sas' items point at the sentinel
      -- system project (status='system', is_system=1) in place of a real one; they still need to
      -- run through Procurement's real Enquiry/Selection/Status tabs, so this can't filter them out
      -- the way every per-project rollup query still correctly does.
      WHERE p.status = 'active' OR p.is_system = 1
      ORDER BY p.project_no, b.sort_order, b.id`);
}

// Project picker for the PR composer (Group 5 Bundle A) — id/label only, no rollups needed.
export async function getActiveProjectsList() {
  return queryAll(
    "SELECT id, project_no, customer_name FROM projects WHERE status = 'active' ORDER BY project_no");
}

// CALC-CHANGES2.md §D — the project page's Design panel: this project's calc_sheets with a
// pass/warn/fail read off each sheet's latest snapshot (replaying the frozen results against the
// live global validations via runValidations — same "Reproduce" idea the Audit panel/PDF use,
// just the classification only, no full recompute since a snapshot already has its results frozen),
// its calc_drawings (reusing lib/calc.js's getCalcDrawings — same table §B's Drawings panel reads),
// and a merge-sorted activity timeline capped at 5. One project only, so unlike the list-page
// getDesignProgressByProject this can afford the validations replay.
export async function getProjectDesignSummary(projectId) {
  const [sheets, validations, drawings, notes] = await Promise.all([
    queryAll('SELECT * FROM calc_sheets WHERE project_id = ? ORDER BY id', [projectId]),
    queryAll('SELECT * FROM calc_validations'),
    getCalcDrawings(projectId),
    queryAll(
      `SELECT n.* FROM calc_notes n JOIN calc_sheets s ON s.id = n.calc_sheet_id WHERE s.project_id = ? ORDER BY n.id DESC LIMIT 5`,
      [projectId]
    ),
  ]);

  const calcSheets = [];
  for (const s of sheets) {
    const latest = await queryOne('SELECT * FROM calc_snapshots WHERE calc_sheet_id = ? ORDER BY id DESC LIMIT 1', [s.id]);
    let status = 'no_data';
    if (latest) {
      const checks = runValidations(validations, JSON.parse(latest.results));
      const failing = checks.filter((c) => !c.pass);
      status = failing.some((c) => c.severity === 'fail') ? 'fail' : failing.length ? 'warn' : 'pass';
    }
    calcSheets.push({ id: s.id, name: s.name, status, latestSnapshotAt: latest?.ts || null });
  }

  // Merge-sorted activity feed — snapshot saves, drawing file uploads, and (sheet-scoped) notes,
  // most recent first, capped at 5. A glance card, not an audit log (Audit already exists for that).
  const snapshotEvents = calcSheets.filter((s) => s.latestSnapshotAt).map((s) => ({ ts: s.latestSnapshotAt, kind: 'snapshot', label: `Snapshot saved — ${s.name}` }));
  const drawingEvents = drawings.flatMap((d) => d.files.map((f) => ({ ts: f.uploadedAt, kind: 'drawing', label: `${f.fileName} uploaded — ${d.name}` })));
  const noteEvents = notes.map((n) => ({ ts: n.created_at, kind: 'note', label: `Note added: ${n.note.slice(0, 60)}${n.note.length > 60 ? '…' : ''}` }));
  const activity = [...snapshotEvents, ...drawingEvents, ...noteEvents]
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .slice(0, 5);

  return { calcSheets, drawings, activity };
}

// Scope of Supply / Work Order — shared by Design and Engineering, see
// app/api/scope-of-supply/route.js for the create/edit side.
export async function getScopeOfSupply(projectId) {
  return queryAll('SELECT * FROM scope_of_supply WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
}

// CALC-CHANGES2.md §E — Operations' Design pipeline banner counts, mirrored off
// getProcurementFlowCounts's shape (one query set, a pure per-project stage derivation, a strict
// partition so every relevant project lands in exactly one bucket). No new status enum: since
// Methodology is global (§A), "are all formulas approved" is one project-independent flag at any
// moment, not something to compute per project — that's what collapses the derivation to cheap SQL
// instead of a per-project engine recompute.
function deriveDesignStage(hasSnapshot, allFormulasApproved, drawings) {
  if (!hasSnapshot) return 'concept';
  if (!allFormulasApproved) return 'calculation';
  if (drawings.some((d) => d.status === 'as_built')) return 'released';
  const allDrawingsApproved = drawings.length === 0 || drawings.every((d) => d.status === 'approved' || d.status === 'as_built');
  return allDrawingsApproved ? 'approved' : 'review';
}

export async function getDesignFlowCounts() {
  const [formulas, sheets, snapshots, drawings, milestones] = await Promise.all([
    queryAll('SELECT status FROM calc_formulas'),
    queryAll('SELECT id, project_id FROM calc_sheets'),
    queryAll('SELECT DISTINCT calc_sheet_id FROM calc_snapshots WHERE calc_sheet_id IS NOT NULL'),
    queryAll('SELECT project_id, status FROM calc_drawings'),
    // Same pool-widening fix as getDesignWork: a project with an overdue/blocked Design milestone
    // but no calc sheet or drawing yet used to be invisible to this chart entirely (it was only
    // built from sheets/drawings project ids). Pulling in milestones' project ids too means this
    // chart's totals and the table's project pool stay in agreement — no more "13 overdue but only
    // 1 row" mismatches. (Per-stage "how many are overdue" badges were tried and removed — see
    // decisions log; this chart shows stage totals only, unfiltered by status.)
    queryAll("SELECT project_id FROM milestones WHERE department = 'Design'"),
  ]);
  const allFormulasApproved = formulas.length > 0 && formulas.every((f) => f.status === 'approved');
  const sheetsWithSnapshot = new Set(snapshots.map((s) => s.calc_sheet_id));

  const projectIds = new Set([
    ...sheets.map((s) => s.project_id),
    ...drawings.map((d) => d.project_id),
    ...milestones.map((m) => m.project_id),
  ]);
  const counts = { concept: 0, calculation: 0, review: 0, approved: 0, released: 0 };
  for (const projectId of projectIds) {
    const projectSheets = sheets.filter((s) => s.project_id === projectId);
    const hasSnapshot = projectSheets.some((s) => sheetsWithSnapshot.has(s.id));
    const projectDrawings = drawings.filter((d) => d.project_id === projectId);
    counts[deriveDesignStage(hasSnapshot, allFormulasApproved, projectDrawings)]++;
  }
  return counts;
}

// Project-scoped mirror of deriveDesignStage — Project page Row 2 slot 3's Design chip
// (DESIGN-OPS-REDESIGN.md). Findings: not a literal reuse of getDesignFlowCounts, which is
// global — this returns one stage key for one project, not a counts object.
export async function getProjectDesignStage(projectId) {
  const [formulas, sheets, snapshots, drawings] = await Promise.all([
    queryAll('SELECT status FROM calc_formulas'),
    queryAll('SELECT id FROM calc_sheets WHERE project_id = ?', [projectId]),
    queryAll('SELECT DISTINCT calc_sheet_id FROM calc_snapshots WHERE calc_sheet_id IS NOT NULL'),
    queryAll('SELECT status FROM calc_drawings WHERE project_id = ?', [projectId]),
  ]);
  const allFormulasApproved = formulas.length > 0 && formulas.every((f) => f.status === 'approved');
  const sheetsWithSnapshot = new Set(snapshots.map((s) => s.calc_sheet_id));
  const hasSnapshot = sheets.some((s) => sheetsWithSnapshot.has(s.id));
  return deriveDesignStage(hasSnapshot, allFormulasApproved, drawings);
}

// CALC-CHANGES2.md §E — the Operations Design tab's master table (Project | Customer | Design
// Progress | Bottleneck | Calc Status | Drawings), mirroring MasterBomTable's data shape
// (getBomWork). "Bottleneck" reuses the exact ['overdue','blocked'] partition TodayBand.jsx/
// app/page.js's Open Actions cards already use, applied to this project's Design milestones,
// oldest planned_end first. Calc Status/Drawings reuse the same cheap snapshot-exists /
// approved-status proxies as getDesignProgressByProject (no per-project engine recompute for a
// list view) — only split into two columns instead of one combined ratio.
export async function getDesignWork() {
  const [projects, milestones, sheets, sheetSnapshots, drawings] = await Promise.all([
    queryAll("SELECT id, project_no, customer_name FROM projects WHERE status = 'active'"),
    queryAll("SELECT * FROM milestones WHERE department = 'Design'"),
    queryAll('SELECT id, project_id FROM calc_sheets'),
    queryAll('SELECT DISTINCT calc_sheet_id FROM calc_snapshots WHERE calc_sheet_id IS NOT NULL'),
    queryAll('SELECT project_id, status FROM calc_drawings'),
  ]);
  const sheetsWithSnapshot = new Set(sheetSnapshots.map((s) => s.calc_sheet_id));
  const msByProject = {};
  milestones.forEach((m) => { (msByProject[m.project_id] ||= []).push(m); });
  const sheetsByProject = {};
  sheets.forEach((s) => { (sheetsByProject[s.project_id] ||= []).push(s); });
  const drawingsByProject = {};
  drawings.forEach((d) => { (drawingsByProject[d.project_id] ||= []).push(d); });

  return projects.map((p) => {
    const ms = msByProject[p.id] || [];
    const delayed = ms.filter((m) => ['overdue', 'blocked'].includes(effectiveStatus(m).code))
      .sort((a, b) => (a.planned_end || '').localeCompare(b.planned_end || ''));
    const projSheets = sheetsByProject[p.id] || [];
    const calcDone = projSheets.filter((s) => sheetsWithSnapshot.has(s.id)).length;
    const projDrawings = drawingsByProject[p.id] || [];
    const drawingsDone = projDrawings.filter((d) => d.status === 'approved' || d.status === 'as_built').length;
    return {
      id: p.id, project_no: p.project_no, customer_name: p.customer_name,
      designProgress: { done: calcDone + drawingsDone, total: projSheets.length + projDrawings.length },
      bottleneck: delayed[0]?.milestone_label || null,
      calcStatus: { done: calcDone, total: projSheets.length },
      drawings: { done: drawingsDone, total: projDrawings.length },
      hasDesignMilestones: ms.length > 0,
    };
  // Was: calcStatus.total > 0 || drawings.total > 0 only — that excluded any project with overdue/
  // blocked Design milestones but no calc sheet or drawing created yet, which is exactly the gap
  // that made "13 overdue" show only 1 matching project in the table. Now a project qualifies if
  // it has calc/drawing data OR any Design milestone at all, so the table's project pool matches
  // the same pool the overdue/blocked/due-soon pills are counted from.
  }).filter((p) => p.calcStatus.total > 0 || p.drawings.total > 0 || p.hasDesignMilestones);
}

// CALC-CHANGES2.md §D — Projects list's read-only Design Progress column. Cheap SQL-only proxy
// rather than running the calc engine's full validation pass per project on every /projects load
// (that's what the project-page DesignPanel does, scoped to one project): a calc sheet counts as
// "done" once it has any saved snapshot (calculated at least once), a drawing once its status is
// approved/as_built. Returns { [projectId]: { done, total } }; a project with no calc_sheets and no
// calc_drawings is simply absent (rendered as "—" by the caller).
export async function getDesignProgressByProject() {
  const [sheets, snapshots, drawings] = await Promise.all([
    queryAll('SELECT id, project_id FROM calc_sheets'),
    queryAll('SELECT DISTINCT calc_sheet_id FROM calc_snapshots WHERE calc_sheet_id IS NOT NULL'),
    queryAll("SELECT project_id, status FROM calc_drawings"),
  ]);
  const sheetsWithSnapshot = new Set(snapshots.map((s) => s.calc_sheet_id));
  const byProject = {};
  sheets.forEach((s) => {
    const bucket = (byProject[s.project_id] ||= { done: 0, total: 0 });
    bucket.total++;
    if (sheetsWithSnapshot.has(s.id)) bucket.done++;
  });
  drawings.forEach((d) => {
    const bucket = (byProject[d.project_id] ||= { done: 0, total: 0 });
    bucket.total++;
    if (d.status === 'approved' || d.status === 'as_built') bucket.done++;
  });
  return byProject;
}

// Bulk-fetch specific bom_items by id, with the same selected-supplier join as getSourcingItems —
// used by the Requests tab's cancel-request detail overlay (§ Phase 4), which needs full item
// context (spec/qty/selected supplier) that a `tasks` row alone doesn't carry.
export async function getBomItemsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return queryAll(
    `SELECT b.*, s.name AS selected_supplier_name, sq.unit_price AS selected_unit_price
       FROM bom_items b
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
       LEFT JOIN suppliers s ON s.id = sq.supplier_id
      WHERE b.id IN (${placeholders})`, ids);
}

// Where an item's real progress actually sits, independent of what purchase_status literally
// says. purchase_status is NOT kept live by every action — logging a quote (POST
// /api/supplier-quotes) and selecting a supplier (.../select-supplier) never touch it; only PO
// issue/unissue (Transit <-> Ordered), the cancel flow (-> Cancelled), and a manual Status-tab
// override actually move it day to day. So an item can carry logged quotes, or even a selected
// supplier with only a *draft* PO (select-supplier auto-drafts one but doesn't stamp po_ref until
// issue — lib/procurement.js addItemToDraftPO), while still reading "Enquiry" in the column. Trust
// an explicit forward-progressed value (Ordered/Transit/Received/In-Stock — each only reachable
// via a real action or a deliberate override); for anything still sitting at Enquiry/Comparison/
// null/unrecognized, upgrade using the same signals the Phase 5.0 backfill used — a selected
// supplier or a stamped po_ref means Ordered, else a logged quote means Comparison, else Enquiry —
// the honest "how far did this actually get" reading, not just whatever word is stored.
function deriveActiveStage(it) {
  if (['Ordered', 'Transit'].includes(it.purchase_status)) return it.purchase_status.toLowerCase();
  if (it.selected_quote_id || it.po_ref) return 'ordered';
  if (it.quote_count > 0) return 'comparison';
  return 'enquiry';
}

// Cancelling never clears po_ref/selected_quote_id/the logged quotes (accept-cancellations and
// the manual override both just flip purchase_status) — so the same signals still tell us which
// stage a cancelled item was really at. po_status (the most recent PO's own status, if any) is
// what distinguishes "cancelled after the PO was issued" (Transit) from "cancelled with a supplier
// selected or a PO still in draft" (Ordered) — po_ref alone can't tell those apart once the item's
// own status has been overwritten to Cancelled.
function deriveCancelledOrigin(it) {
  if (it.selected_quote_id || it.po_ref) return it.po_status === 'issued' ? 'transit' : 'ordered';
  if (it.quote_count > 0) return 'comparison';
  return 'enquiry';
}

// Operations' Procurement flow diagram (§2/§4 of the redesign, extended § Phase 5.0b polish to
// use the real D4 stage names instead of coarser Sourcing/Selection/PO-issued buckets): a strict,
// mutually-exclusive partition of every active-project item (plus pending requests) into exactly
// one column, so the counts sum to the whole — unlike the /procurement workspace's tabs, which
// deliberately overlap (an item can show in both Sourcing and Selection at once for editing
// convenience). cancelledFrom is a second, non-exclusive breakdown of the cancelled bucket alone —
// which D4 stage each cancelled item was really at when it was cancelled.
export async function getProcurementFlowCounts() {
  const [pendingNew, pendingCancel, items] = await Promise.all([
    queryOne("SELECT COUNT(*) AS c FROM procurement_requests WHERE status = 'pending'"),
    queryOne("SELECT COUNT(*) AS c FROM tasks WHERE department = 'Procurement' AND bom_item_id IS NOT NULL AND status = 'open'"),
    queryAll(
      `SELECT b.purchase_status, b.po_ref, b.selected_quote_id,
              (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count,
              (SELECT po.status FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
                WHERE pi.bom_item_id = b.id ORDER BY pi.id DESC LIMIT 1) AS po_status
         FROM bom_items b JOIN projects p ON p.id = b.project_id
        WHERE p.status = 'active'`),
  ]);
  const counts = {
    requests: pendingNew.c + pendingCancel.c,
    enquiry: 0, comparison: 0, ordered: 0, transit: 0, received: 0, in_stock: 0, cancelled: 0,
    cancelledFrom: { enquiry: 0, comparison: 0, ordered: 0, transit: 0 },
  };
  for (const it of items) {
    if (it.purchase_status === 'Cancelled') {
      counts.cancelled++;
      counts.cancelledFrom[deriveCancelledOrigin(it)]++;
    } else if (it.purchase_status === 'Received') counts.received++;
    else if (it.purchase_status === 'In-Stock') counts.in_stock++;
    else counts[deriveActiveStage(it)]++;
  }
  return counts;
}

// The full price-history log for one item — every quote any supplier has given, oldest first so
// the UI can show "how has this moved."
export async function getItemQuotes(bomItemId) {
  return queryAll(
    `SELECT sq.*, s.name AS supplier_name
       FROM supplier_quotes sq JOIN suppliers s ON s.id = sq.supplier_id
      WHERE sq.bom_item_id = ? ORDER BY sq.quoted_at`, [bomItemId]);
}

// V2-CHANGES.md Phase 5.1 — RFQ reads. "N/M responded" for Enquiry's quote-count cell, one query
// for the whole tab (same "fetch once, filter client-side" precedent as getAllQuotes/getSourcingItems).
export async function getRfqSummaryByItem() {
  const rows = await queryAll(
    `SELECT ri.bom_item_id, ri.rfq_id, r.rfq_no,
            COUNT(rs.id) AS invited, COUNT(rs.responded_at) AS responded
       FROM rfq_items ri
       JOIN rfqs r ON r.id = ri.rfq_id
       JOIN rfq_suppliers rs ON rs.rfq_id = ri.rfq_id
      WHERE ri.bom_item_id IS NOT NULL
      GROUP BY ri.bom_item_id, ri.rfq_id`);
  const byItem = {};
  for (const r of rows) byItem[r.bom_item_id] = r; // one active RFQ per item, most-recent wins (GROUP BY order is fine at this scale)
  return byItem;
}

// Full detail for one RFQ (resend view, and the authenticated GET /api/rfqs/[id]) — items +
// per-supplier token/sent/responded state.
export async function getRfqDetail(id) {
  const rfq = await queryOne('SELECT * FROM rfqs WHERE id = ?', [id]);
  if (!rfq) return null;
  const [items, suppliers] = await Promise.all([
    queryAll(
      `SELECT b.id AS bom_item_id, b.material_description, b.moc, b.size_spec, b.qty_text
         FROM rfq_items ri JOIN bom_items b ON b.id = ri.bom_item_id
        WHERE ri.rfq_id = ?`, [id]),
    queryAll(
      `SELECT rs.*, s.name AS supplier_name, s.phone, s.email
         FROM rfq_suppliers rs JOIN suppliers s ON s.id = rs.supplier_id
        WHERE rs.rfq_id = ?`, [id]),
  ]);
  return { ...rfq, items, suppliers };
}

// The supplier-portal lookup (D12) — shared by the page (app/rfq/[token]/page.js) and the public
// API route (app/api/rfq/[token]/route.js) so the two can never read it differently. Returns null
// for an unknown token; callers check token_expires themselves (a route 410s, the page shows an
// "expired" state) since "not found" vs "expired" need different messages.
export async function getRfqByToken(token) {
  const rs = await queryOne(
    `SELECT rs.*, s.name AS supplier_name, r.rfq_no
       FROM rfq_suppliers rs JOIN rfqs r ON r.id = rs.rfq_id JOIN suppliers s ON s.id = rs.supplier_id
      WHERE rs.token = ?`, [token]);
  if (!rs) return null;
  const items = await queryAll(
    `SELECT ri.id AS rfq_item_id, b.id AS bom_item_id, b.material_description, b.moc, b.size_spec, b.qty_text
       FROM rfq_items ri JOIN bom_items b ON b.id = ri.bom_item_id
      WHERE ri.rfq_id = ?`, [rs.rfq_id]);
  // Plain-object copies, not the raw libsql Row instances — app/rfq/[token]/page.js passes this
  // straight from a server component into the client-rendered RfqPortalForm, and a Row (a
  // Proxy-backed exotic object under the hood) trips React's "only plain objects" RSC serialization
  // check even though every field on it is ordinary data. Every other consumer of queryAll/queryOne
  // in this codebase reads rows API-side (through NextResponse.json, already a JSON boundary) or in
  // a page->client-component prop that happens not to nest a Row inside another Row — this is the
  // first server->client prop path that does, so the fix is scoped here rather than globally.
  return { ...rs, items: items.map(it => ({ ...it })) };
}

// Every PO line this item has ever appeared on (§ Phase 4 cancel-request detail overlay — "when was
// a PO issued for it"), most recent first. Normally 0 or 1 row; more than one only if a PO was
// cancelled and the item later re-selected onto a new one — po_items keeps that history rather than
// being overwritten, same precedent as supplier_quotes never being edited in place.
export async function getBomItemPoInfo(bomItemId) {
  return queryAll(
    `SELECT po.id, po.po_no, po.status, po.issued_at, po.created_at, s.name AS supplier_name
       FROM po_items pi
       JOIN purchase_orders po ON po.id = pi.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE pi.bom_item_id = ?
      ORDER BY po.created_at DESC`, [bomItemId]);
}

export async function getSuppliers() {
  return queryAll('SELECT * FROM suppliers WHERE active = 1 ORDER BY name');
}

// V2-CHANGES.md Group 6 Phase 6.1 — Sales' simple Sale Order list (D14, free-text so_no).
export async function getSaleOrders() {
  return queryAll('SELECT * FROM sale_orders ORDER BY created_at DESC');
}

// V3_CHANGES.md A3 — the ERPNext integration seam, read side. Every caller gets a plain
// { metric_key: { value_num, value_text, source, as_of } } map — Track B changes what WRITES this
// table (ERPNext instead of demo seed data); this reader and every UI that calls it stays
// unchanged. scope defaults to 'ALL' (portfolio-wide); pass a project_no for a per-project metric
// once one exists. Invariant (V3_CHANGES.md §2.4): callers display these values verbatim, never
// recompute them.
export async function getErpSnapshot(scope = 'ALL') {
  const rows = await queryAll(
    'SELECT metric_key, value_num, value_text, source, as_of FROM erp_snapshot WHERE scope = ?',
    [scope]
  );
  const byKey = {};
  for (const r of rows) byKey[r.metric_key] = r;
  return byKey;
}

// V3_CHANGES.md A4 — the light Sales+Marketing pipeline over `customers`. Deliberately one flat
// list (small table at this company's scale, same precedent as getSuppliers/getSaleOrders) —
// client-side stage grouping for the Kanban, same pattern StagesPanel.jsx already uses.
export async function getOpportunities() {
  return queryAll('SELECT * FROM opportunities ORDER BY created_at DESC');
}

// Executive 360's "Sales Pipeline" tile — counts + open value by stage, Won/Lost excluded from the
// "open pipeline" total since they're resolved, not active.
export async function getOpportunityPipelineCounts() {
  const rows = await queryAll('SELECT stage, value_num FROM opportunities');
  const counts = { Lead: 0, Qualified: 0, Quoted: 0, Won: 0, Lost: 0 };
  let openValue = 0;
  for (const r of rows) {
    if (counts[r.stage] === undefined) continue;
    counts[r.stage]++;
    if (r.stage !== 'Won' && r.stage !== 'Lost') openValue += r.value_num || 0;
  }
  return { counts, openValue, total: rows.length };
}

// V2-CHANGES.md Group 6 Phase 6.2/6.3 (D8) — Stores' inventory workbench. `available` nets out
// every *active* reservation (Phase 6.3) so no two requests can ever draw the same physical units —
// on_hand alone would let that happen. Small table at this company's scale (built up materials, not
// a warehouse's full SKU list), one query, client-side low-stock/search filtering downstream.
export async function getInventoryItems() {
  return queryAll(
    `SELECT i.*,
            i.on_hand - COALESCE((SELECT SUM(r.qty) FROM inventory_reservations r
                                    WHERE r.inventory_item_id = i.id AND r.status = 'active'), 0) AS available
       FROM inventory_items i
      ORDER BY i.description`
  );
}

// Stores' own read of open requests — Stores can't see Procurement's Enquiry tab, so the Reserve
// action needs its own list. Any source (bom/stock/sas), any project including the sentinel one
// (Phase 6.4). NOT IN with a COALESCE default, not isOpenStatus's Set client-side, since this is a
// SQL WHERE — same NULL-safety idiom getPurchaseOrders' fulfilled-check already learned the hard
// way (SYSTEM.md §5c Phase 4: bare NOT IN silently drops NULL rows).
export async function getOpenBomItems() {
  return queryAll(
    `SELECT b.*, p.project_no, p.customer_name, p.is_system AS project_is_system
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
      WHERE COALESCE(b.purchase_status, '${DEFAULT_PURCHASE_STATUS}') NOT IN ('Received','Cancelled','In-Stock')
      ORDER BY b.id DESC`
  );
}

// Active (unissued, unreleased) reservations — the workbench's second list, Issue/Release act here.
export async function getActiveReservations() {
  return queryAll(
    `SELECT r.*, i.description AS inventory_description, b.material_description, b.qty_text,
            p.project_no, p.is_system AS project_is_system
       FROM inventory_reservations r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       JOIN bom_items b ON b.id = r.bom_item_id
       JOIN projects p ON p.id = b.project_id
      WHERE r.status = 'active'
      ORDER BY r.created_at DESC`
  );
}

// Every quote ever logged, fetched once for the whole /procurement workspace — small table at this
// company's scale, and fetching it flat lets the Sourcing tab (quote counts, comparison) and the
// Suppliers tab (per-supplier history) both filter client-side instead of each needing their own
// per-item/per-supplier round trip.
export async function getAllQuotes() {
  return queryAll(
    `SELECT sq.*, s.name AS supplier_name
       FROM supplier_quotes sq JOIN suppliers s ON s.id = sq.supplier_id
      ORDER BY sq.quoted_at DESC`);
}

// One supplier's full quote history, with enough item/project context to be readable without a
// second lookup — the seed of a future "what has this supplier quoted us" view.
export async function getSupplierQuotes(supplierId) {
  return queryAll(
    `SELECT sq.*, b.material_description, p.project_no
       FROM supplier_quotes sq
       JOIN bom_items b ON b.id = sq.bom_item_id
       JOIN projects p ON p.id = b.project_id
      WHERE sq.supplier_id = ? ORDER BY sq.quoted_at DESC`, [supplierId]);
}

// New-item requests from Engineering/Design, waiting on Procurement to accept (§4.0). Pending by
// default — the Requests inbox only needs the open queue; resolved ones aren't shown anywhere yet.
export async function getProcurementRequests(status = 'pending') {
  return queryAll(
    `SELECT r.*, p.project_no, p.customer_name
       FROM procurement_requests r JOIN projects p ON p.id = r.project_id
      WHERE r.status = ? ORDER BY r.created_at`, [status]);
}

export async function getPurchaseOrders(filter = {}) {
  const where = [];
  const args = [];
  if (filter.status) { where.push('po.status = ?'); args.push(filter.status); }
  if (filter.supplier_id) { where.push('po.supplier_id = ?'); args.push(filter.supplier_id); }
  const sql = `
    SELECT po.*, s.name AS supplier_name,
           (SELECT COUNT(*) FROM po_items WHERE po_id = po.id) AS item_count,
           (SELECT COALESCE(SUM(amount), 0) FROM po_items WHERE po_id = po.id) AS subtotal,
           -- V2-CHANGES.md Group 4a — a PO can span projects (po_items.project_id, nullable). Show
           -- the single project when it's one, "Multiple" when it's several. COUNT(DISTINCT ...)
           -- ignores NULLs, so a PO whose lines have no project reads as 0 → "—".
           (SELECT COUNT(DISTINCT pi.project_id) FROM po_items pi WHERE pi.po_id = po.id) AS project_count,
           (SELECT p.project_no FROM po_items pi JOIN projects p ON p.id = pi.project_id
             WHERE pi.po_id = po.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS first_project_no,
           -- V2-CHANGES.md Group 6 Phase 6.4 — a stock/sas line's project_id is the sentinel system
           -- project (D7); surface enough to label it "Stock"/"SO #..." instead of the sentinel's
           -- literal placeholder project_no, same as ProcurementWorkspace's other tabs.
           (SELECT p.is_system FROM po_items pi JOIN projects p ON p.id = pi.project_id
             WHERE pi.po_id = po.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS first_project_is_system,
           (SELECT b.source FROM po_items pi JOIN bom_items b ON b.id = pi.bom_item_id
             WHERE pi.po_id = po.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS first_bom_source,
           (SELECT b.sale_order_no FROM po_items pi JOIN bom_items b ON b.id = pi.bom_item_id
             WHERE pi.po_id = po.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS first_sale_order_no,
           (SELECT COUNT(*) FROM po_items pi JOIN bom_items b ON b.id = pi.bom_item_id
             WHERE pi.po_id = po.id
               AND COALESCE(b.purchase_status, '${DEFAULT_PURCHASE_STATUS}') NOT IN ('Received','Cancelled','In-Stock')) AS unresolved_count
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY po.created_at DESC`;
  const rows = await queryAll(sql, args);
  // Fulfilled = nothing left to do with this PO — either every line item it carries has resolved
  // (received/cancelled/in-stock), or the PO document itself was cancelled outright. Drives the PO
  // tab's Fulfilled toggle (§ Phase 4) so a resolved PO stops cluttering the active list.
  // NB: purchase_status is often NULL (never explicitly set, defaults to Enquiry everywhere else
  // in the app) — plain `NOT IN (...)` on a NULL column is SQL's classic trap, it evaluates to
  // UNKNOWN and silently drops out of the COUNT instead of counting as unresolved. COALESCE first.
  return rows.map(po => ({
    ...po,
    fulfilled: po.status === 'cancelled' || (po.item_count > 0 && po.unresolved_count === 0),
  }));
}

export async function getPurchaseOrderDetail(id) {
  const po = await queryOne(
    `SELECT po.*, s.name AS supplier_name, s.gst_no AS supplier_gst, s.address AS supplier_address,
            s.phone AS supplier_phone, s.email AS supplier_email
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`, [id]);
  if (!po) return null;
  const items = await queryAll(
    `SELECT poi.*, p.project_no FROM po_items poi LEFT JOIN projects p ON p.id = poi.project_id
      WHERE poi.po_id = ? ORDER BY poi.sort_order, poi.id`, [id]);
  return { po, items };
}

// USB device approval dashboard — PM sees every machine/request; an operator sees only their own.
export async function getUsbDashboard(user) {
  const machineFilter = isPM(user) ? '' : 'WHERE m.user_id = ?';
  const machineArgs = isPM(user) ? [] : [user.id];
  const machines = await queryAll(
    `SELECT m.*, u.username AS owner_username, u.display_name AS owner_display_name
       FROM machines m LEFT JOIN users u ON u.id = m.user_id ${machineFilter} ORDER BY m.created_at DESC`,
    machineArgs
  );
  const machineIds = machines.map(m => m.id);
  let requests = [];
  if (machineIds.length) {
    const placeholders = machineIds.map(() => '?').join(',');
    requests = await queryAll(
      `SELECT r.*, d.vendor_id, d.product_id, d.serial, d.label, d.whitelisted, d.first_seen, d.kind,
              m.name AS machine_name, m.user_id
         FROM usb_requests r
         JOIN usb_devices d ON d.id = r.device_id
         JOIN machines m ON m.id = r.machine_id
        WHERE r.machine_id IN (${placeholders})
        ORDER BY r.id DESC`,
      machineIds
    );
  }
  requests = requests.map(r => ({ ...r, status: usbEffectiveStatus(r) }));

  let audit = [];
  if (isPM(user) && requests.length) {
    const reqIds = requests.map(r => r.id);
    const placeholders = reqIds.map(() => '?').join(',');
    audit = await queryAll(
      `SELECT * FROM usb_audit WHERE request_id IN (${placeholders}) ORDER BY id ASC`,
      reqIds
    );
  }
  const auditByRequest = {};
  for (const a of audit) (auditByRequest[a.request_id] ||= []).push(a);

  const devices = isPM(user) ? await queryAll('SELECT * FROM usb_devices ORDER BY first_seen DESC') : [];

  return {
    machines,
    requests: requests.map(r => ({ ...r, timeline: auditByRequest[r.id] || [] })),
    devices,
  };
}

// Browser policy dashboard — same machine-scoping as devices. PM also sees the policy list.
export async function getBrowserDashboard(user) {
  const machineFilter = isPM(user) ? '' : 'WHERE m.user_id = ?';
  const machineArgs = isPM(user) ? [] : [user.id];
  const machines = await queryAll(
    `SELECT m.id, m.name, m.user_id, u.display_name AS owner_display_name, u.username AS owner_username
       FROM machines m LEFT JOIN users u ON u.id = m.user_id ${machineFilter} ORDER BY m.created_at DESC`,
    machineArgs
  );
  const machineIds = machines.map(m => m.id);
  let requests = [];
  if (machineIds.length) {
    const placeholders = machineIds.map(() => '?').join(',');
    requests = await queryAll(
      `SELECT r.*, m.name AS machine_name, m.user_id
         FROM browser_requests r JOIN machines m ON m.id = r.machine_id
        WHERE r.machine_id IN (${placeholders}) ORDER BY r.id DESC`,
      machineIds
    );
  }
  requests = requests.map(r => ({ ...r, status: usbEffectiveStatus(r) }));

  const policies = isPM(user)
    ? await queryAll("SELECT * FROM approval_policies WHERE kind = 'browser' ORDER BY target")
    : [];

  return { machines, requests, policies };
}

// ---- Production tabs: calendar + worker daily sheet ----

// The two calendar layers for a date range, across one or more departments: ad-hoc tasks
// (including ones raised BY another department FOR this one — from_department set, see
// app/api/production/tasks/route.js) and milestones already scheduled on projects. from/to are
// grid bounds (lib/date.js monthGridBounds/weekBounds/yearBounds — whichever the caller's view
// needs). Used to pill a third source, tickets — collapsed into tasks/milestones/notifications,
// see lib/notify.js's header comment.
export async function getDepartmentCalendar(departments, from, to) {
  const inDepts = departments.map(() => '?').join(',');
  const [tasks, milestones] = await Promise.all([
    queryAll(
      `SELECT id, title, due_date AS date, status, assigned_to, department, from_department
         FROM tasks
        WHERE department IN (${inDepts}) AND due_date BETWEEN ? AND ?
        ORDER BY due_date, id`,
      [...departments, from, to]
    ),
    queryAll(
      `SELECT m.id, m.milestone_label AS title, m.planned_end AS date, m.status, m.department,
              m.project_id, p.project_no, p.customer_name
         FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE m.department IN (${inDepts}) AND m.planned_end BETWEEN ? AND ?
        ORDER BY m.planned_end, m.id`,
      [...departments, from, to]
    ),
  ]);
  return { tasks, milestones };
}

// Right rail: open tasks due on or before `through`. Caller passes todayISO() — never SQLite's
// date('now'), which is UTC and so rolls over 5.5h early for the factory (see lib/date.js).
export async function getOpenDepartmentTasks(departments, through) {
  const inDepts = departments.map(() => '?').join(',');
  return queryAll(
    `SELECT * FROM tasks
      WHERE department IN (${inDepts}) AND status = 'open' AND due_date <= ?
      ORDER BY due_date, id`,
    [...departments, through]
  );
}

// The daily sheet. LEFT JOIN so a worker with no row yet comes back with null status — that's
// what the "unmarked" tally counts, and what tells the card it has nothing saved.
export async function getWorkerSheet(date) {
  return queryAll(
    `SELECT w.id, w.name, w.trade,
            d.status, d.project_id, d.milestone_id, d.notes
       FROM workers w
       LEFT JOIN worker_days d ON d.worker_id = w.id AND d.date = ?
      WHERE w.department = 'Production' AND w.active = 1
      ORDER BY w.name`,
    [date]
  );
}

// Roster tab — inactive workers included, listed last.
export async function getWorkers() {
  return queryAll(
    "SELECT * FROM workers WHERE department = 'Production' ORDER BY active DESC, name"
  );
}

// Active projects with their Production milestones (12 of the 25 template rows), shaped for the
// sheet's two cascading selects. One query for the whole picker rather than a fetch per project.
export async function getProductionMilestoneOptions() {
  const rows = await queryAll(
    `SELECT p.id AS project_id, p.project_no, p.customer_name,
            m.id AS milestone_id, m.milestone_label, m.sort_order
       FROM projects p JOIN milestones m ON m.project_id = p.id
      WHERE p.status = 'active' AND m.department = 'Production'
      ORDER BY p.project_no, m.sort_order`
  );
  const byProject = {};
  for (const r of rows) {
    (byProject[r.project_id] ||= {
      id: Number(r.project_id),
      project_no: r.project_no,
      customer_name: r.customer_name,
      milestones: [],
    }).milestones.push({ id: Number(r.milestone_id), label: r.milestone_label });
  }
  return Object.values(byProject);
}

// ---- Cross-department tasks + notifications ----
// (Tickets are gone — see lib/notify.js's header comment for what replaced them.)

// The Nav bell's payload — polled every 20s on every page, so it stays two indexed scans. The link
// target used to come from a LEFT JOIN tickets; a notification now points at a milestone or a task
// directly, so project_id is resolved from whichever one is set. Same flat output shape
// (n.project_id) as before — NotificationBell.jsx / NotificationsPanel.jsx need no changes.
export async function getNotifications(userId, limit = 20) {
  const [items, count] = await Promise.all([
    queryAll(
      `SELECT n.id, n.kind, n.milestone_id, n.task_id, n.title, n.body, n.read_at, n.created_at,
              COALESCE(m.project_id, tk.project_id) AS project_id
         FROM notifications n
         LEFT JOIN milestones m ON m.id = n.milestone_id
         LEFT JOIN tasks tk     ON tk.id = n.task_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`, [userId, limit]),
    queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]),
  ]);
  return { items, unread: count?.n || 0 };
}

// Cross-department tasks for one project — the project-page panel's list, replacing what used to
// be getTickets({ projectId }). Every department on a project sees both its inbox (tasks raised FOR
// it) and its outbox (tasks it raised elsewhere) filtered client-side in DepartmentPanel, same as
// the old ticket list did. ORDER BY: open before done (SQLite sorts false<true), then soonest due.
export async function getProjectTasks(projectId) {
  return queryAll(
    `SELECT * FROM tasks WHERE project_id = ?
      ORDER BY status = 'done', due_date, id DESC`,
    [projectId]
  );
}

// Workflow Stages — one query for all 8 department tabs (same idiom as tasks above): every stage
// instance under this project's milestones, joined with its milestone's department/key/label so
// the pooled Kanban board and the Manage picker don't need a second round trip.
export async function getProjectStages(projectId) {
  return queryAll(
    `SELECT ms.*, m.department, m.milestone_label, m.milestone_key
       FROM milestone_stages ms JOIN milestones m ON m.id = ms.milestone_id
      WHERE m.project_id = ?
      ORDER BY m.sort_order, ms.sort_order, ms.id`,
    [projectId]
  );
}

// Named stage templates (§3c) — small tables, fetched whole and grouped client-side by
// milestone_key, same pattern as the rest of this file. Two queries (header + items) rather than a
// join so the component gets flat arrays instead of a nested shape to unpack.
export async function getStageTemplates() {
  const templates = await queryAll(`SELECT * FROM stage_templates ORDER BY department, milestone_key, name`);
  const items = await queryAll(`SELECT * FROM stage_template_items ORDER BY template_id, sort_order`);
  return { templates, items };
}

// One department's full task list (any project, any status) — Operations' per-department panel,
// replacing getTickets({ department }). Deliberately unbounded by date, unlike
// getOpenDepartmentTasks (right-rail "due soon" list): this is the inbox/outbox history view, same
// as the old ticket list was.
export async function getDepartmentTasks(department) {
  return queryAll(
    `SELECT * FROM tasks WHERE department = ? OR from_department = ?
      ORDER BY status = 'done', due_date, id DESC`,
    [department, department]
  );
}

// ================================================================================================
// V3_CHANGES.md §12 — CRM + Selling + HR + Recruitment read helpers. Same "queryAll/queryOne,
// flat shape, client-side grouping where needed" idiom as the rest of this file.
// ================================================================================================

// --- CRM ----------------------------------------------------------------------------------------

export async function getLeads() {
  return queryAll('SELECT * FROM leads ORDER BY created_at DESC');
}

export async function getCampaigns() {
  return queryAll('SELECT * FROM campaigns ORDER BY created_at DESC');
}

export async function getSalesStages() {
  return queryAll('SELECT * FROM sales_stages WHERE active = 1 ORDER BY sort_order');
}

export async function getOpportunityItems(opportunityId) {
  return queryAll('SELECT * FROM opportunity_items WHERE opportunity_id = ? ORDER BY sort_order, id', [opportunityId]);
}

// One shared timeline across lead/opportunity/customer — exactly one FK is set per row
// (notifications-style, V3_CHANGES.md §12 decision 4), so a single WHERE against whichever id was
// passed is enough; the caller supplies which column to filter on.
export async function getCrmNotes({ leadId, opportunityId, customerId }) {
  if (leadId) return queryAll('SELECT * FROM crm_notes WHERE lead_id = ? ORDER BY created_at DESC', [leadId]);
  if (opportunityId) return queryAll('SELECT * FROM crm_notes WHERE opportunity_id = ? ORDER BY created_at DESC', [opportunityId]);
  if (customerId) return queryAll('SELECT * FROM crm_notes WHERE customer_id = ? ORDER BY created_at DESC', [customerId]);
  return [];
}

// Same "exactly one link column set" shape as getCrmNotes, backed by the shared `tasks` table
// (lib/db.js — reused rather than a new crm_tasks table). No filter -> every CRM task, for the
// Tasks sidebar panel, joined with the linked record's name so the list is readable without a
// second round-trip per row.
export async function getCrmTasks({ leadId, opportunityId, customerId } = {}) {
  if (leadId) return queryAll('SELECT * FROM tasks WHERE lead_id = ? ORDER BY due_date', [leadId]);
  if (opportunityId) return queryAll('SELECT * FROM tasks WHERE opportunity_id = ? ORDER BY due_date', [opportunityId]);
  if (customerId) return queryAll('SELECT * FROM tasks WHERE customer_id = ? ORDER BY due_date', [customerId]);
  return queryAll(`
    SELECT t.*, l.lead_name, o.title AS opportunity_title, c.name AS customer_name
    FROM tasks t
    LEFT JOIN leads l ON t.lead_id = l.id
    LEFT JOIN opportunities o ON t.opportunity_id = o.id
    LEFT JOIN customers c ON t.customer_id = c.id
    WHERE t.lead_id IS NOT NULL OR t.opportunity_id IS NOT NULL OR t.customer_id IS NOT NULL
    ORDER BY t.status = 'done', t.due_date
  `);
}

// --- Selling --------------------------------------------------------------------------------------

export async function getCustomers() {
  return queryAll('SELECT * FROM customers WHERE active = 1 ORDER BY name');
}

export async function getCustomerDetail(id) {
  const [customer, contacts, addresses, notes] = await Promise.all([
    queryOne('SELECT * FROM customers WHERE id = ?', [id]),
    queryAll('SELECT * FROM contacts WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, name', [id]),
    queryAll('SELECT * FROM addresses WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, address_type', [id]),
    queryAll('SELECT * FROM crm_notes WHERE customer_id = ? ORDER BY created_at DESC', [id]),
  ]);
  return customer ? { ...customer, contacts, addresses, notes } : null;
}

export async function getContacts(customerId) {
  return queryAll('SELECT * FROM contacts WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, name', [customerId]);
}

export async function getAddresses(customerId) {
  return queryAll('SELECT * FROM addresses WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, address_type', [customerId]);
}

export async function getQuotations() {
  return queryAll(
    `SELECT q.*, c.name AS customer_name FROM quotations q JOIN customers c ON c.id = q.customer_id
      ORDER BY q.created_at DESC`
  );
}

export async function getQuotationDetail(id) {
  const [quotation, items] = await Promise.all([
    queryOne(`SELECT q.*, c.name AS customer_name FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`, [id]),
    queryAll('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order, id', [id]),
  ]);
  return quotation ? { ...quotation, items } : null;
}

export async function getSaleOrderDetail(id) {
  const [so, items] = await Promise.all([
    queryOne('SELECT * FROM sale_orders WHERE id = ?', [id]),
    queryAll('SELECT * FROM sale_order_items WHERE sale_order_id = ? ORDER BY sort_order, id', [id]),
  ]);
  return so ? { ...so, items } : null;
}

// --- HR ---------------------------------------------------------------------------------------

export async function getDesignations() {
  return queryAll('SELECT * FROM designations WHERE active = 1 ORDER BY name');
}

export async function getEmploymentTypes() {
  return queryAll('SELECT * FROM employment_types WHERE active = 1 ORDER BY name');
}

export async function getEmployees() {
  return queryAll(
    `SELECT e.*, d.name AS designation_name, et.name AS employment_type_name, m.name AS reports_to_name
       FROM employees e
       LEFT JOIN designations d ON d.id = e.designation_id
       LEFT JOIN employment_types et ON et.id = e.employment_type_id
       LEFT JOIN employees m ON m.id = e.reports_to
      ORDER BY e.active DESC, e.name`
  );
}

export async function getEmployeeDetail(id) {
  const [employee, shift, onboarding, separation] = await Promise.all([
    queryOne(
      `SELECT e.*, d.name AS designation_name, et.name AS employment_type_name, m.name AS reports_to_name
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN employment_types et ON et.id = e.employment_type_id
         LEFT JOIN employees m ON m.id = e.reports_to
        WHERE e.id = ?`, [id]
    ),
    queryOne(
      `SELECT sa.*, st.name AS shift_name FROM shift_assignments sa JOIN shift_types st ON st.id = sa.shift_type_id
        WHERE sa.employee_id = ? AND (sa.to_date IS NULL OR sa.to_date >= date('now'))
        ORDER BY sa.from_date DESC LIMIT 1`, [id]
    ),
    queryOne(
      `SELECT * FROM employee_onboarding WHERE employee_id = ? ORDER BY id DESC LIMIT 1`, [id]
    ),
    queryOne(
      `SELECT * FROM employee_separation WHERE employee_id = ? ORDER BY id DESC LIMIT 1`, [id]
    ),
  ]);
  if (!employee) return null;
  const onboardingTasks = onboarding ? await queryAll('SELECT * FROM onboarding_tasks WHERE onboarding_id = ? ORDER BY sort_order, id', [onboarding.id]) : [];
  const separationTasks = separation ? await queryAll('SELECT * FROM separation_tasks WHERE separation_id = ? ORDER BY sort_order, id', [separation.id]) : [];
  return { ...employee, currentShift: shift, onboarding: onboarding ? { ...onboarding, tasks: onboardingTasks } : null, separation: separation ? { ...separation, tasks: separationTasks } : null };
}

export async function getAttendanceForDate(date) {
  return queryAll(
    `SELECT e.id AS employee_id, e.name, e.employee_type, e.department, ad.status, ad.notes, ad.project_id, ad.milestone_id,
            ad.in_time, ad.out_time, ad.working_hours, ad.late_entry, ad.early_exit
       FROM employees e
       LEFT JOIN attendance_days ad ON ad.employee_id = e.id AND ad.date = ?
      WHERE e.active = 1
      ORDER BY e.employee_type, e.name`,
    [date]
  );
}

export async function getLeaveTypes() {
  return queryAll('SELECT * FROM leave_types WHERE active = 1 ORDER BY name');
}

export async function getLeaveRequests(status = null, employeeId = null) {
  const conditions = [];
  const args = [];
  if (status) { conditions.push('lr.status = ?'); args.push(status); }
  if (employeeId) { conditions.push('lr.employee_id = ?'); args.push(employeeId); }
  const sql = `SELECT lr.*, e.name AS employee_name, lt.name AS leave_type_name
                 FROM leave_requests lr
                 JOIN employees e ON e.id = lr.employee_id
                 JOIN leave_types lt ON lt.id = lr.leave_type_id
                ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
                ORDER BY lr.created_at DESC`;
  return queryAll(sql, args);
}

// V3_CHANGES.md §13 — Employee detail Sheet's history view (past attendance / shift assignments;
// past leave requests reuse getLeaveRequests(null, employeeId) above).
export async function getAttendanceHistory(employeeId, limit = 60) {
  return queryAll(
    'SELECT * FROM attendance_days WHERE employee_id = ? ORDER BY date DESC LIMIT ?',
    [employeeId, limit]
  );
}

export async function getShiftHistory(employeeId) {
  return queryAll(
    `SELECT sa.*, st.name AS shift_name FROM shift_assignments sa JOIN shift_types st ON st.id = sa.shift_type_id
      WHERE sa.employee_id = ? ORDER BY sa.from_date DESC`,
    [employeeId]
  );
}

export async function getHolidays() {
  return queryAll('SELECT * FROM holidays ORDER BY holiday_date');
}

export async function getShiftTypes() {
  return queryAll('SELECT * FROM shift_types WHERE active = 1 ORDER BY start_time');
}

export async function getShiftAssignments() {
  return queryAll(
    `SELECT sa.*, e.name AS employee_name, st.name AS shift_name
       FROM shift_assignments sa
       JOIN employees e ON e.id = sa.employee_id
       JOIN shift_types st ON st.id = sa.shift_type_id
      WHERE sa.to_date IS NULL OR sa.to_date >= date('now')
      ORDER BY st.start_time, e.name`
  );
}

// --- Recruitment --------------------------------------------------------------------------------

export async function getJobOpenings() {
  return queryAll(
    `SELECT jo.*, et.name AS employment_type_name,
            (SELECT COUNT(*) FROM job_applicants ja WHERE ja.job_opening_id = jo.id) AS applicant_count
       FROM job_openings jo LEFT JOIN employment_types et ON et.id = jo.employment_type_id
      ORDER BY jo.status = 'closed', jo.created_at DESC`
  );
}

export async function getJobApplicants(jobOpeningId = null) {
  const sql = `SELECT ja.*, jo.title AS job_title FROM job_applicants ja JOIN job_openings jo ON jo.id = ja.job_opening_id
               ${jobOpeningId ? 'WHERE ja.job_opening_id = ?' : ''}
               ORDER BY ja.created_at DESC`;
  return queryAll(sql, jobOpeningId ? [jobOpeningId] : []);
}

export async function getApplicantDetail(id) {
  const [applicant, interviews, offers] = await Promise.all([
    queryOne(`SELECT ja.*, jo.title AS job_title FROM job_applicants ja JOIN job_openings jo ON jo.id = ja.job_opening_id WHERE ja.id = ?`, [id]),
    queryAll('SELECT * FROM interviews WHERE applicant_id = ? ORDER BY scheduled_at', [id]),
    queryAll('SELECT * FROM job_offers WHERE applicant_id = ? ORDER BY created_at DESC', [id]),
  ]);
  return applicant ? { ...applicant, interviews, offers } : null;
}

// V3_CHANGES.md §12 Phase 5 — Executive 360's real Workforce card. Replaces the demo
// erp_snapshot-sourced hr_headcount tile now that HR is native (invariant amendment, §2.4).
export async function getWorkforceCounts(today) {
  const [headcount, presentToday, onLeaveToday, openings] = await Promise.all([
    queryOne('SELECT COUNT(*) AS n FROM employees WHERE active = 1'),
    queryOne("SELECT COUNT(*) AS n FROM attendance_days WHERE date = ? AND status IN ('present','half')", [today]),
    queryOne("SELECT COUNT(*) AS n FROM attendance_days WHERE date = ? AND status = 'leave'", [today]),
    queryOne("SELECT COUNT(*) AS n FROM job_openings WHERE status = 'open'"),
  ]);
  return { headcount: headcount.n, presentToday: presentToday.n, onLeaveToday: onLeaveToday.n, openOpenings: openings.n };
}

// --- HR completion bundle: Payroll / Loans / Expense Claims — read helpers ----------------------

export async function getSalaryStructures() {
  return queryAll('SELECT * FROM salary_structures ORDER BY active DESC, name');
}

export async function getSalaryStructureDetail(id) {
  const structure = await queryOne('SELECT * FROM salary_structures WHERE id = ?', [id]);
  if (!structure) return null;
  const components = await queryAll('SELECT * FROM salary_structure_components WHERE salary_structure_id = ? ORDER BY sort_order', [id]);
  return { ...structure, components };
}

export async function getSalaryStructureAssignments() {
  return queryAll(
    `SELECT ssa.*, e.name AS employee_name, e.employee_code, s.name AS structure_name
       FROM salary_structure_assignments ssa
       JOIN employees e ON e.id = ssa.employee_id
       JOIN salary_structures s ON s.id = ssa.salary_structure_id
      ORDER BY ssa.active DESC, ssa.from_date DESC`
  );
}

export async function getEmployeeSalaryAssignment(employeeId) {
  return queryOne(
    `SELECT ssa.*, s.name AS structure_name FROM salary_structure_assignments ssa
       JOIN salary_structures s ON s.id = ssa.salary_structure_id
      WHERE ssa.employee_id = ? AND ssa.active = 1 ORDER BY ssa.from_date DESC LIMIT 1`,
    [employeeId]
  );
}

export async function getProfessionalTaxSlabs() {
  return queryAll('SELECT * FROM professional_tax_slabs ORDER BY state, min_gross');
}

export async function getIncomeTaxSlabs() {
  return queryAll('SELECT * FROM income_tax_slabs ORDER BY financial_year DESC, min_income');
}

export async function getPayrollRuns() {
  return queryAll(
    `SELECT pr.*, (SELECT COUNT(*) FROM salary_slips s WHERE s.payroll_run_id = pr.id) AS slip_count
       FROM payroll_runs pr ORDER BY pr.period_year DESC, pr.period_month DESC`
  );
}

export async function getPayrollRunDetail(id) {
  const run = await queryOne('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run) return null;
  const slips = await queryAll(
    `SELECT s.*, e.name AS employee_name, e.employee_code FROM salary_slips s
       JOIN employees e ON e.id = s.employee_id WHERE s.payroll_run_id = ? ORDER BY e.name`,
    [id]
  );
  return { ...run, slips };
}

export async function getSalarySlips(employeeId = null) {
  const sql = `SELECT s.*, e.name AS employee_name, e.employee_code FROM salary_slips s
                 JOIN employees e ON e.id = s.employee_id
                ${employeeId ? 'WHERE s.employee_id = ?' : ''}
                ORDER BY s.period_year DESC, s.period_month DESC`;
  return queryAll(sql, employeeId ? [employeeId] : []);
}

export async function getSalarySlipDetail(id) {
  const slip = await queryOne(
    `SELECT s.*, e.name AS employee_name, e.employee_code, e.bank_name, e.bank_account_no, e.bank_ifsc
       FROM salary_slips s JOIN employees e ON e.id = s.employee_id WHERE s.id = ?`,
    [id]
  );
  if (!slip) return null;
  const components = await queryAll('SELECT * FROM salary_slip_components WHERE salary_slip_id = ? ORDER BY sort_order', [id]);
  return { ...slip, components };
}

export async function getAdditionalSalary(employeeId = null) {
  const sql = `SELECT a.*, e.name AS employee_name FROM additional_salary a JOIN employees e ON e.id = a.employee_id
                ${employeeId ? 'WHERE a.employee_id = ?' : ''} ORDER BY a.period_year DESC, a.period_month DESC`;
  return queryAll(sql, employeeId ? [employeeId] : []);
}

export async function getEmployeeLoans(employeeId = null) {
  const sql = `SELECT l.*, e.name AS employee_name FROM employee_loans l JOIN employees e ON e.id = l.employee_id
                ${employeeId ? 'WHERE l.employee_id = ?' : ''} ORDER BY l.status = 'active' DESC, l.created_at DESC`;
  return queryAll(sql, employeeId ? [employeeId] : []);
}

export async function getLoanDetail(id) {
  const loan = await queryOne('SELECT l.*, e.name AS employee_name FROM employee_loans l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', [id]);
  if (!loan) return null;
  const repayments = await queryAll('SELECT * FROM loan_repayments WHERE loan_id = ? ORDER BY installment_no', [id]);
  return { ...loan, repayments };
}

export async function getExpenseClaimTypes() {
  return queryAll('SELECT * FROM expense_claim_types WHERE active = 1 ORDER BY name');
}

export async function getExpenseClaims(status = null, employeeId = null) {
  const conditions = [], args = [];
  if (status) { conditions.push('c.status = ?'); args.push(status); }
  if (employeeId) { conditions.push('c.employee_id = ?'); args.push(employeeId); }
  const sql = `SELECT c.*, e.name AS employee_name FROM expense_claims c JOIN employees e ON e.id = c.employee_id
                ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY c.created_at DESC`;
  return queryAll(sql, args);
}

export async function getExpenseClaimDetail(id) {
  const claim = await queryOne('SELECT c.*, e.name AS employee_name FROM expense_claims c JOIN employees e ON e.id = c.employee_id WHERE c.id = ?', [id]);
  if (!claim) return null;
  const items = await queryAll(
    `SELECT i.*, t.name AS type_name FROM expense_claim_items i LEFT JOIN expense_claim_types t ON t.id = i.expense_claim_type_id
      WHERE i.expense_claim_id = ? ORDER BY i.sort_order`,
    [id]
  );
  return { ...claim, items };
}

export async function getEmployeeAdvances(employeeId = null) {
  const sql = `SELECT a.*, e.name AS employee_name FROM employee_advances a JOIN employees e ON e.id = a.employee_id
                ${employeeId ? 'WHERE a.employee_id = ?' : ''} ORDER BY a.status != 'settled', a.created_at DESC`;
  return queryAll(sql, employeeId ? [employeeId] : []);
}
