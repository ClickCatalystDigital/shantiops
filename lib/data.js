// lib/data.js — server-side read helpers shared by the page components.
import { queryAll, queryOne } from './db';
import { effectiveStatus, worstStatus, biggestBlocker, slaStatus } from './sla';
import { cumulativeDelay } from './delay';
import { CUSTOMER_PHASES } from './milestones';
import { headDepartments, isPM } from './auth';
import { effectiveStatus as usbEffectiveStatus } from './usb';

const ATTENTION = new Set(['overdue', 'blocked', 'due_now', 'due_soon', 'in_progress']);

export async function getProjectsWithStatus() {
  const projects = await queryAll('SELECT * FROM projects ORDER BY created_at DESC');
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
    "SELECT id, username, display_name, departments, active FROM users WHERE role = 'operator' AND pending = 0 ORDER BY username"
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

// Per-section BOM procurement rollup for one project. closed = CLOSED, RECEIVED, or CANCELLED
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
    if (['CLOSED', 'RECEIVED', 'CANCELLED'].includes(r.purchase_status)) s.closed += r.n;
    else if (r.purchase_status === 'TRANSIT') s.transit += r.n;
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
            SUM(CASE WHEN purchase_status IN ('CLOSED','RECEIVED','CANCELLED') THEN 1 ELSE 0 END) AS closed
       FROM bom_items GROUP BY project_id`);
  const out = {};
  for (const r of rows) {
    out[r.project_id] = { total: r.total, closedPct: r.total ? Math.round((r.closed / r.total) * 100) : 0 };
  }
  return out;
}

// Open BOM work per project for a head's Operations view — the BOM analogue of getMyWork.
// Engineering sees projects with no BOM yet ("upload it"); Procurement/Stores/Production see
// how many items are still open (not CLOSED/RECEIVED/CANCELLED — a cancelled item is resolved,
// nobody should be chasing it). PM sees the open counts for everything.
export async function getBomWork(user) {
  const depts = isPM(user)
    ? ['Engineering', 'Procurement', 'Stores', 'Production']
    : headDepartments(user).filter(d => ['Engineering', 'Procurement', 'Stores', 'Production'].includes(d));
  if (!depts.length) return [];

  const rows = await queryAll(
    `SELECT p.id, p.project_no, p.customer_name,
            COUNT(b.id) AS total,
            SUM(CASE WHEN b.purchase_status IN ('CLOSED','RECEIVED','CANCELLED') THEN 1 ELSE 0 END) AS closed,
            SUM(CASE WHEN b.purchase_status = 'TRANSIT' THEN 1 ELSE 0 END) AS transit
       FROM projects p LEFT JOIN bom_items b ON b.project_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id ORDER BY p.created_at DESC`);

  // closed/transit/pending is the same three-way split BomProgress.jsx already renders per project-
  // page section (§ Phase 4 point 8) — carried here too so Operations' Master BOM card can show the
  // same stacked-bar visual instead of a bare "N open items" count.
  return rows
    .map(r => {
      const closed = r.closed || 0;
      const transit = r.transit || 0;
      return {
        id: r.id, project_no: r.project_no, customer_name: r.customer_name,
        total: r.total, open: r.total - closed, closed, transit, pending: r.total - closed - transit,
      };
    })
    .filter(r => (r.total === 0 ? depts.includes('Engineering') : r.open > 0));
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
    `SELECT b.*, p.project_no, p.customer_name,
            s.name AS selected_supplier_name, sq.unit_price AS selected_unit_price
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
       LEFT JOIN suppliers s ON s.id = sq.supplier_id
      WHERE p.status = 'active'
      ORDER BY p.project_no, b.sort_order, b.id`);
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

// Operations' Procurement flow diagram (§2/§4 of the redesign): a strict, mutually-exclusive
// partition of every active-project item (plus pending requests) into one of 5 pipeline stages,
// so the counts sum to the whole — unlike the /procurement workspace's tabs, which deliberately
// overlap (an item can show in both Sourcing and Selection at once for editing convenience).
export async function getProcurementFlowCounts() {
  const [pendingNew, pendingCancel, items] = await Promise.all([
    queryOne("SELECT COUNT(*) AS c FROM procurement_requests WHERE status = 'pending'"),
    queryOne("SELECT COUNT(*) AS c FROM tasks WHERE department = 'Procurement' AND bom_item_id IS NOT NULL AND status = 'open'"),
    queryAll(
      `SELECT b.purchase_status, b.selected_quote_id,
              (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count
         FROM bom_items b JOIN projects p ON p.id = b.project_id
        WHERE p.status = 'active'`),
  ]);
  const counts = { requests: pendingNew.c + pendingCancel.c, sourcing: 0, selection: 0, po_issued: 0, closed: 0, cancelled: 0 };
  for (const it of items) {
    if (it.purchase_status === 'CANCELLED') counts.cancelled++;
    else if (['CLOSED', 'RECEIVED'].includes(it.purchase_status)) counts.closed++;
    else if (it.selected_quote_id || it.purchase_status === 'TRANSIT') counts.po_issued++;
    else if (it.quote_count > 0) counts.selection++;
    else counts.sourcing++;
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
           (SELECT COUNT(*) FROM po_items pi JOIN bom_items b ON b.id = pi.bom_item_id
             WHERE pi.po_id = po.id
               AND COALESCE(b.purchase_status, 'PENDING') NOT IN ('CLOSED','RECEIVED','CANCELLED')) AS unresolved_count
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY po.created_at DESC`;
  const rows = await queryAll(sql, args);
  // Fulfilled = nothing left to do with this PO — either every line item it carries has resolved
  // (closed/received/cancelled), or the PO document itself was cancelled outright. Drives the PO
  // tab's Fulfilled toggle (§ Phase 4) so a resolved PO stops cluttering the active list.
  // NB: purchase_status is often NULL (never explicitly set, defaults to "PENDING" everywhere else
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
