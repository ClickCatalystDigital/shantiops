// lib/data.js — server-side read helpers shared by the page components.
import { queryAll, queryOne, execute } from './db';
import { effectiveStatus, worstStatus, biggestBlocker, slaStatus } from './sla';
import { cumulativeDelay } from './delay';
import { CUSTOMER_PHASES } from './milestones';
import { headDepartments, isPM, parseDepartmentRoles } from './auth';
import { effectiveStatus as usbEffectiveStatus } from './usb';
import { isOpenStatus, isClosedStatus, DEFAULT_PURCHASE_STATUS, PURCHASE_STATUSES, derivePurchaseStage } from './bom-fields.mjs';
import { projectDependencyStatus } from './dependency.mjs';
import { runValidations } from './calc-engine';
import { getCalcDrawings, sweepDrawingNotifications } from './calc';
import { rollupQty, itemRollupQty, partIdentityKey } from './bom-structure.mjs';
import { jobWorkVariance, calibrationStatus } from './qc-inspections.mjs';
import { todayISO } from './date';
import { financialYear } from './gst-calc.mjs';
import { notifyDepartment } from './notify';

const ATTENTION = new Set(['overdue', 'blocked', 'due_now', 'due_soon', 'in_progress']);

// Which department(s) actually have the ball on a set of milestones right now, and which specific
// milestone(s) of theirs is/are active — raw status, not effectiveStatus, so an overdue-but-active
// milestone still counts as "current" (effectiveStatus relabels it 'overdue' and would otherwise
// drop it from this list). Falls back to the next not-yet-started milestone so a project always
// shows at least one department, even before anyone has actually started work on it. Shared by
// getProjectsWithStatus (cross-project list) and the project-detail page's own Row 2 slot 3 — same
// shape, just scoped to one project's milestones there instead of every project's.
export function activeDepartmentStatus(ms) {
  const activeMs = ms.filter(m => ['in_progress', 'blocked'].includes(m.status));
  const upcoming = activeMs.length ? [] : ms.filter(m => !m.actual_end && m.status !== 'done').slice(0, 1);
  const activeList = [...activeMs, ...upcoming];
  const departments = [...new Set(activeList.map(m => m.department).filter(Boolean))];
  // STORES-SALES-CHANGES.md — "progress" used to mean one thing (Design's own calc-sheet/drawing
  // completeness, regardless of which department actually has the project right now). Two
  // separate, well-defined numbers instead: how far along the department(s) currently holding the
  // project are on THEIR OWN milestones here, and how far along the whole project is. Both are
  // plain milestone done/total, no new concept invented. activeMilestones (the specific
  // in_progress/blocked — or next-up — milestone label(s) within that department) rides alongside
  // so a pill can show both dimensions: which department, and what they're actually doing.
  const departmentProgress = departments.map(department => {
    const deptMs = ms.filter(m => m.department === department);
    const deptDone = deptMs.filter(m => m.actual_end || m.status === 'done').length;
    const activeMilestones = activeList.filter(m => m.department === department).map(m => m.milestone_label);
    return { department, done: deptDone, total: deptMs.length, activeMilestones };
  });
  return { departmentProgress };
}

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
    const { departmentProgress } = activeDepartmentStatus(ms);
    return {
      ...p,
      roll: worstStatus(ms),
      blocker: biggestBlocker(ms),
      progress: ms.length ? Math.round((done / ms.length) * 100) : 0,
      overallDone: done,
      overallTotal: ms.length,
      departmentProgress,
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

// Dependency Chain rollup (SYSTEM.md §5j) — cross-project blocked_by/out_of_order counts, for
// Executive. blocked_by/out_of_order are otherwise only visible one project at a time
// (getProjectDetail); this is the instrument for watching where the chain actually reads as
// blocked, and where milestone-auto and the structural chain disagree, across everything at once
// — the real "let real usage teach us" mechanism the roadmap calls for, not just a hope. Read-only,
// same as the per-project signal; changes nothing.
export async function getDependencyHealthSummary() {
  const milestones = await queryAll(
    `SELECT m.*, p.project_no FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.status = 'active'`
  );
  const bomItems = await queryAll(
    `SELECT b.project_id, b.purchase_status, b.selected_quote_id, b.po_ref,
            (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count
       FROM bom_items b WHERE b.pending_review = 0`
  );
  const msByProject = {};
  milestones.forEach(m => (msByProject[m.project_id] ||= []).push(m));
  const bomByProject = {};
  bomItems.forEach(b => (bomByProject[b.project_id] ||= []).push(b));

  const blocked = [];
  const outOfOrder = [];
  for (const [projectId, ms] of Object.entries(msByProject)) {
    const dep = projectDependencyStatus(ms, bomByProject[projectId] || []);
    dep.forEach((d, i) => {
      const m = ms[i];
      const row = { project_id: Number(projectId), project_no: m.project_no, milestone_label: m.milestone_label, department: m.department };
      if (d.blocked_by) blocked.push({ ...row, blocked_by: d.blocked_by });
      if (d.out_of_order) outOfOrder.push({ ...row, out_of_order: d.out_of_order });
    });
  }
  const byDepartment = {};
  blocked.forEach(b => { byDepartment[b.department] = (byDepartment[b.department] || 0) + 1; });
  return { blockedCount: blocked.length, byDepartment, outOfOrder };
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
  const milestonesRaw = await queryAll(
    'SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order, id', [id]
  );

  // Dependency engine (lib/dependency.mjs) — observational only, v1. `blocked_by` rides alongside
  // the existing human status/effectiveStatus, doesn't replace or gate anything yet. Same BOM
  // signal shape syncProcurementMilestones already queries — pending_review=1 excluded to match,
  // same as getSourcingItems(): a line still sitting in Stores Review isn't visible to or
  // actionable by Procurement yet, so it can't count as a live procurement blocker.
  const bomSignal = await queryAll(
    `SELECT purchase_status, selected_quote_id, po_ref,
            (SELECT COUNT(*) FROM supplier_quotes sq WHERE sq.bom_item_id = b.id) AS quote_count
       FROM bom_items b WHERE b.project_id = ? AND b.pending_review = 0`, [id]
  );
  const depStatus = projectDependencyStatus(milestonesRaw, bomSignal);
  const milestones = milestonesRaw.map((m, i) => ({
    ...m, blocked_by: depStatus[i].blocked_by, out_of_order: depStatus[i].out_of_order,
  }));

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

  // A customer never sees Design's not_started/in_progress internal drafts — only drawings that
  // have actually been put in front of them for review or beyond.
  const allDrawings = await getCalcDrawings(projectId);
  const drawings = allDrawings.filter(d => d.customerVisible && ['under_review', 'approved', 'as_built'].includes(d.status));
  // A visible drawing still under_review (not yet approved) means the ball is in the customer's
  // court — surfaced as the phase's own status, not a separate flag, so the stepper needs no new
  // text to show it.
  const awaitingCustomer = drawings.some(d => d.status === 'under_review' && !d.customerApprovedAt);

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
    if (ph.key === 'design' && status !== 'done' && awaitingCustomer) status = 'awaiting_customer';
    return { key: ph.key, label: ph.label, status };
  });

  const estDispatch = milestones.reduce((a, m) => (m.planned_end && m.planned_end > a ? m.planned_end : a), '');
  // Every past-draft packing list, not just the latest — a project can genuinely ship in more than
  // one consignment (found live on SB-1018: PKL-1005 + PL-1009), and the old LIMIT 1 silently
  // dropped the earlier one from the portal. Same "past draft" rule /packing/[id]'s own page already
  // enforces for a customer viewer.
  const packingLists = await queryAll(
    "SELECT id, packing_no FROM packing_lists WHERE project_id = ? AND status != 'draft' ORDER BY created_at DESC", [projectId]
  );
  // A customer should see an invoice once it's a real document (issued/paid), never a draft still
  // being worked on internally — same "past draft" rule the packing list link already applies.
  const invoices = await queryAll(
    `SELECT id, invoice_no, invoice_date, status, total FROM sales_invoices
      WHERE project_id = ? AND status != 'draft' ORDER BY invoice_date DESC`, [projectId]
  );
  // A QC statutory document (Form IV A folder) only reaches the portal once QC Head has explicitly
  // shared it (customer_visible — same idiom as calc_drawings, §6 investigation) — the server also
  // re-enforces the all-parts-linked hard gate before that flag can ever be set (see PATCH
  // /api/qc-documents/[id]).
  const qcCertificates = await queryAll(
    `SELECT id, doc_id, customer_visible_at FROM qc_documents
      WHERE project_id = ? AND customer_visible = 1 ORDER BY customer_visible_at DESC`, [projectId]
  );
  return {
    project, phases, estDispatch: estDispatch || null,
    packingLists: packingLists.map(p => ({ id: p.id, packingNo: p.packing_no })),
    drawings, invoices, qcCertificates,
  };
}

export async function getPackingLists() {
  return queryAll(
    `SELECT pl.*, (SELECT COUNT(*) FROM packing_items WHERE packing_list_id = pl.id) AS item_count,
            si.invoice_no AS linked_invoice_no
       FROM packing_lists pl
       LEFT JOIN sales_invoices si ON si.id = pl.sales_invoice_id
      ORDER BY pl.created_at DESC`
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

// STERP item 33 (§5p) — this project's Job-Work Inspections. variance = sent_qty - received_qty,
// computed live here rather than stored (same precedent as bom_assemblies' roll-up qty).
export async function getJobWorkInspections(projectId) {
  const rows = await queryAll(
    'SELECT * FROM job_work_inspections WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
  return rows.map(r => ({ ...r, variance_qty: jobWorkVariance(r.sent_qty, r.received_qty) }));
}

// STERP items 34/35 (§5p) — the whole calibration bank (small at this company's scale, same
// "fetch flat, filter client-side" precedent as getTestCertificates). status is derived live from
// due_date, never stored: expired (past due), due_soon (within 30 days), ok, or blocked (manual
// override, takes priority over the date).
export async function getCalibrationItems() {
  const rows = await queryAll('SELECT * FROM calibration_items ORDER BY due_date IS NULL, due_date, name');
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return rows.map(r => ({ ...r, status: calibrationStatus(r, today, soon) }));
}

// QC V1 (QC-CHANGES.md) — Test Certificate bank + statutory documents. --------------------------

// The whole bank, small at this company's scale (17 seeded) — same "fetch flat, filter client-side"
// idiom as getSuppliers/getAllQuotes, with a linked-part count so the /qc list can show reuse
// ("used in N parts") without a second round trip per row.
// The bank, cross-project. Each cert carries its project associations (many-to-many via
// certificate_projects) as parallel `project_ids` / `project_nos` concatenations for chip display and
// editing. Pass projectId to filter to certs used in that project.
export async function getTestCertificates(projectId = null) {
  const where = projectId
    ? 'WHERE EXISTS (SELECT 1 FROM certificate_projects cp WHERE cp.certificate_id = tc.id AND cp.project_id = ?)'
    : '';
  return queryAll(
    `SELECT tc.*,
            (SELECT GROUP_CONCAT(cp.project_id) FROM certificate_projects cp WHERE cp.certificate_id = tc.id) AS project_ids,
            (SELECT GROUP_CONCAT(p.project_no, '||') FROM certificate_projects cp JOIN projects p ON p.id = cp.project_id WHERE cp.certificate_id = tc.id) AS project_nos,
            (SELECT COUNT(*) FROM qc_document_parts WHERE test_certificate_id = tc.id) AS used_in_parts
       FROM test_certificates tc ${where} ORDER BY tc.created_at DESC`, projectId ? [projectId] : []);
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

// Every project's statutory documents, for the /qc workspace Docs tab — same linked/total counts
// as getQcDocuments plus the owning project's label, so a cross-project list row can link off its
// own project_id.
export async function getAllQcDocuments() {
  return queryAll(
    `SELECT d.*, p.project_no, p.customer_name,
            (SELECT COUNT(*) FROM qc_document_parts WHERE document_id = d.id) AS total_parts,
            (SELECT COUNT(*) FROM qc_document_parts WHERE document_id = d.id AND test_certificate_id IS NOT NULL) AS linked_parts
       FROM qc_documents d LEFT JOIN projects p ON p.id = d.project_id ORDER BY d.created_at DESC`);
}

// NCR register (plan §5e) — project name/no joined for display, same shape as getAllQcDocuments.
export async function getNcrs({ projectId, status } = {}) {
  const where = [];
  const args = [];
  if (projectId) { where.push('n.project_id = ?'); args.push(Number(projectId)); }
  if (status) { where.push('n.status = ?'); args.push(status); }
  return queryAll(
    `SELECT n.*, p.project_no, p.customer_name FROM ncr_records n
       JOIN projects p ON p.id = n.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY n.id DESC`,
    args
  );
}

// Hold-point gate (plan §5d) — job cards still waiting on a QC release, for QcHoldPanel.jsx.
export async function getQcHoldPoints() {
  return queryAll(
    `SELECT jc.id, jc.project_id, jc.section, jc.status, jc.work_order_id, p.project_no, wo.wo_no
       FROM job_cards jc
       JOIN projects p ON p.id = jc.project_id
       LEFT JOIN work_orders wo ON wo.id = jc.work_order_id
      WHERE jc.requires_qc_hold = 1 AND jc.qc_released_at IS NULL
      ORDER BY jc.id DESC`
  );
}

// Counts for the project page's QC summary card: certs uploaded / with a PDF, docs total / finalized
// (all parts linked = PDF-ready). One round trip each, cheap at this scale.
export async function getQcProjectSummary(projectId) {
  const certs = await queryOne(
    `SELECT COUNT(*) AS total, COUNT(tc.pdf_key) AS with_pdf
       FROM certificate_projects cp JOIN test_certificates tc ON tc.id = cp.certificate_id
      WHERE cp.project_id = ?`, [projectId]);
  const docs = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN (SELECT COUNT(*) FROM qc_document_parts WHERE document_id = d.id AND test_certificate_id IS NULL) = 0
                     THEN 1 ELSE 0 END) AS finalized
       FROM qc_documents d WHERE d.project_id = ?`, [projectId]);
  return {
    certs_total: certs?.total || 0,
    certs_with_pdf: certs?.with_pdf || 0,
    docs_total: docs?.total || 0,
    docs_finalized: docs?.finalized || 0,
  };
}

// One document's full editor payload: header fields + every part row, each carrying its linked
// certificate's fields inline (or all-NULL if unlinked) — the "display-only, fetched from the TC"
// columns the document editor renders, per the QC V1 plan's hard rule that these are never inputs.
export async function getQcDocumentDetail(id) {
  const document = await queryOne('SELECT * FROM qc_documents WHERE id = ?', [id]);
  if (!document) return null;
  // sp.code/bi.material_description power the named-parts reconciliation display (lib/qc-bom-sync.js's
  // reconcilePartsCertificates): sp.code is which physical cut piece a part's cert was inherited
  // from, and comparing part_name to bi.material_description is how the client tells a real named
  // part apart from the plain single-row fallback (which always shares that text — see
  // lib/qc-bom-sync.js's namedPartRows) without a second round trip. pieces_cut/parts_qty are the
  // "N of Q cut" fulfillment count — computed here, not stored anywhere, since it's just a live
  // count of however many stock_pieces currently carry this exact (bom_item_id, part_name).
  // tc.heat_no (Q1) and the receipt->supplier chain off the linked piece (Q3, gap-closure round,
  // 2026-08-26) — heat_no existed on test_certificates but nothing selected it here; receipt_id
  // existed on stock_pieces but no QC query ever joined through it, so "which supplier did this
  // inspected material come from" was only answerable via a raw SQL join outside the app.
  const parts = await queryAll(
    `SELECT p.*, tc.certificate_no, tc.cast_no AS tc_cast_no, tc.heat_no AS tc_heat_no, tc.plate_no AS tc_plate_no,
            tc.material_spec, tc.steel_maker, tc.chem_c, tc.chem_mn, tc.chem_p, tc.chem_s, tc.chem_si,
            tc.ys, tc.uts, tc.elongation, tc.bend_test, tc.steel_making_process, tc.heat_treatment,
            tc.pdf_key, sp.code AS linked_piece_code, bi.material_description AS bom_material_description,
            sr.inward_batch_no AS receipt_inward_batch_no, rs.name AS receipt_supplier_name,
            (SELECT COUNT(*) FROM stock_pieces WHERE bom_item_id = p.bom_item_id AND part_name = p.part_name) AS pieces_cut
       FROM qc_document_parts p
       LEFT JOIN test_certificates tc ON tc.id = p.test_certificate_id
       LEFT JOIN stock_pieces sp ON sp.id = p.stock_piece_id
       LEFT JOIN bom_items bi ON bi.id = p.bom_item_id
       LEFT JOIN stock_receipts sr ON sr.id = sp.receipt_id
       LEFT JOIN suppliers rs ON rs.id = sr.supplier_id
      WHERE p.document_id = ? ORDER BY p.sort_order, p.id`, [id]);
  const mountings = await queryAll(
    'SELECT * FROM qc_mountings WHERE document_id = ? ORDER BY sort_order, id', [id]);
  const groups = await queryAll(
    `SELECT g.*, cd.dg_no AS linked_drawing_dg_no
       FROM qc_iiia_groups g LEFT JOIN calc_drawings cd ON cd.id = g.calc_drawing_id
      WHERE g.document_id = ? ORDER BY g.sort_order, g.id`, [id]);
  // Folder manifest's "Drawing No's" line (§ DG- reversal) — derived, not typed: every approved
  // drawing on this document's own project, since qc_documents.project_id and calc_drawings
  // .project_id already share the project and "one model per folder" (client-confirmed
  // 2026-08-16) means one document per project in the normal case. A plain list, not a from/to
  // range — dg_no is a global counter, not per-project, so a min/max range would falsely imply a
  // contiguous run through other projects' drawings on a statutory document.
  const approvedDrawings = await queryAll(
    `SELECT dg_no FROM calc_drawings WHERE project_id = ? AND status = 'approved' AND dg_no IS NOT NULL ORDER BY id`,
    [document.project_id]);
  document.approved_drawing_codes = approvedDrawings.map(d => d.dg_no);
  return { document, parts, mountings, groups };
}

// QC TC<->BOM-item suggestion feature — the project's BOM items, flat, for the "Link to BOM item"
// picker and the client-side suggestCertificates() call (lib/tc-match.js). Same "fetch flat, filter
// client-side" idiom as getTestCertificates — this company's per-project BOM size doesn't need a
// server-side search endpoint.
export async function getBomItemsForProject(projectId) {
  // requires_*/received_*/drawing fields (gap-closure round, 2026-08-26, Q2) — QC's "Link to BOM
  // item" picker previously showed only description/spec text; QC linking a document part to an
  // MTC-flagged line had no way to see that requirement or the drawing revision it was released
  // against, without leaving this screen for BomTable (which QC never renders at all). Same
  // canonical fields BomTable.jsx/TraceabilityBadges already read — reused, not re-derived.
  return queryAll(
    `SELECT b.id, b.material_description, b.moc, b.size_spec, b.make, b.category, b.category_fields_json, b.inventory_item_id,
            b.requires_heat_no, b.requires_mtc, b.requires_supplier_batch, b.requires_serial_no,
            b.received_heat_no, b.received_mtc_no, b.received_supplier_batch_no, b.received_serial_no,
            b.assembly_id, b.group_label,
            dw.name AS drawing_name, COALESCE(b.drawing_revision_at_release, dw.revision) AS drawing_revision
       FROM bom_items b
       LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id
      WHERE b.project_id = ? ORDER BY b.sort_order, b.id`, [projectId]);
}

// The full approval-history bank (small table, same idiom) — filtered client-side to whatever
// inventory_item_id the part's linked BOM item actually carries.
export async function getTcMatchApprovals() {
  return queryAll('SELECT * FROM tc_item_match_approvals');
}

export async function getPackingDetail(id) {
  const list = await queryOne('SELECT * FROM packing_lists WHERE id = ?', [id]);
  if (!list) return null;
  const items = await queryAll(
    'SELECT * FROM packing_items WHERE packing_list_id = ? ORDER BY box_no, s_no, id', [id]
  );
  // Dispatch accounting integration — whether the freight expense has already been posted
  // (postJournalEntry's own source_type/source_id check is the single source of truth for this,
  // not a separate status column that could drift out of sync with the actual ledger).
  const freightPosted = await queryOne(
    "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [id]
  );
  return { list: { ...list, freightPosted: !!freightPosted }, items };
}

// Functional heads — for the PM's access matrix / user management screen (Settings).
export async function getFunctionalHeads() {
  const rows = await queryAll(
    "SELECT id, username, display_name, departments, department_roles, active, safe_pass FROM users WHERE role = 'operator' AND pending = 0 ORDER BY username"
  );
  return rows.map(r => ({ ...r, departments: headDepartments(r), departmentRoles: parseDepartmentRoles(r.department_roles) }));
}

export async function getDesignTeamMembers() {
  const rows = await queryAll(
    `SELECT e.id, e.employee_code, e.name, e.user_id, e.department, e.active,
            u.username, u.display_name, u.active AS user_active, u.departments, u.department_roles
       FROM employees e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.active = 1 AND (e.department = 'Design' OR INSTR(',' || COALESCE(e.access_departments, '') || ',', ',Design,') > 0)
      ORDER BY e.name`
  );
  return rows.map(r => ({ ...r, departmentRoles: parseDepartmentRoles(r.department_roles) }));
}

export async function getAvailableSystemEmployees() {
  return queryAll(
    `SELECT id, employee_code, name, department
       FROM employees
      WHERE active = 1 AND user_id IS NULL
      ORDER BY name`
  );
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
    `SELECT b.*, s.name AS selected_supplier_name, sq.unit_price AS selected_unit_price,
            (SELECT COUNT(*) FROM supplier_quotes sq2 WHERE sq2.bom_item_id = b.id) AS quote_count,
            it.item_code AS catalog_item_code, dw.name AS drawing_name, dw.dg_no AS drawing_dg_no,
            -- Frozen snapshot wins once released (Phase 1, 20.1): calc_drawings.revision is a live,
            -- mutable field, so an already-released line must keep reporting the revision that
            -- actually drove it, not whatever the drawing has since been bumped to. An unreleased
            -- line has no snapshot yet, so it correctly still shows the current live revision.
            COALESCE(b.drawing_revision_at_release, dw.revision) AS drawing_revision,
            tpl.name AS template_name
       FROM bom_items b
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
       LEFT JOIN suppliers s ON s.id = sq.supplier_id
       LEFT JOIN items it ON it.id = b.item_id
       LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id
       LEFT JOIN bom_templates tpl ON tpl.id = b.template_id
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
  const pending = bom.filter(b => !carriedIds.has(b.id));
  // Dispatch-facing gate: a pending line is only actually packable once Production has explicitly
  // marked it done (production_done, BOM_FIELD_OWNERS.Production) — Dispatch shouldn't pack
  // something still on the shop floor. Kept as a separate field from `pending` rather than folding
  // the check into `pending` itself: `pending` also feeds the generic "Pending" badge every
  // department sees on the Master BOM table (still-not-on-a-packing-list), which shouldn't start
  // reading "not pending" just because production_done isn't set on old rows.
  //
  // requires_manufacturing (Feature C, 2026-09-02) — a bought-out line that never touches Production
  // is DERIVED as ready the moment it's actually Received/In-Stock, never by letting Stores flip
  // production_done itself (that field stays exactly Production-owned, unchanged — see
  // BOM_FIELD_OWNERS). This is a read-side computation only; conflating "no fabrication needed"
  // with "the material has arrived" would let a line be marked packable before it's ever received.
  const readyForPacking = pending.filter(b =>
    b.requires_manufacturing
      ? b.production_done
      : (b.purchase_status === 'Received' || b.purchase_status === 'In-Stock')
  );
  return { bom, pending, readyForPacking, imports };
}

// Per-section BOM procurement rollup for one project. closed = Received, Cancelled, or In-Stock
// (resolved either way — a cancelled item isn't open work, even though it wasn't delivered);
// everything else (incl. no status yet) counts as pending. transit shown separately.
// BOM closed-% per project, for the Executive forecast table. { projectId: {total, closedPct} }.
// Projects Stores has started receiving materials for (>=1 Received/In-Stock BOM item) — the point
// a project becomes QC's business (incoming inspection begins per-item on receipt, §5p). Used to
// scope the QC workspace's project filter; unioned there with projects already in the cert/doc bank
// so nothing already worked-on ever drops out of the list.
export async function getReceivedProjectIds() {
  const rows = await queryAll(
    "SELECT DISTINCT project_id FROM bom_items WHERE purchase_status IN ('Received','In-Stock')");
  return rows.map(r => r.project_id);
}

// Materials-complete handoff to Production/QC — extracted from the bom-items PATCH route so both
// Procurement (purchase_status → a closed value) and Stores (grn_ref filled in) can trigger the
// same "cleared to build" signal from their own action, instead of it only ever firing off
// purchase_status. Deliberately broader than isClosedStatus/getBomRollupAll's "closed" (which stays
// Received/Cancelled/In-Stock only, for the stage-bar/forecast displays that are specifically about
// procurement progress) — here a line also counts as done the moment Stores has physically logged
// its GRN, even if Procurement hasn't (or won't) touch purchase_status for it. Self-dedupes on
// dedupe_key so calling this from either side after every line is harmless — it only actually
// notifies once per project.
export async function checkMaterialsComplete(projectId) {
  const roll = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN purchase_status IN ('Received','Cancelled','In-Stock') OR grn_ref IS NOT NULL THEN 1 ELSE 0 END) AS closed
       FROM bom_items WHERE project_id = ?`, [projectId]);
  if (!roll || roll.total === 0 || Number(roll.closed) !== Number(roll.total)) return;

  const proj = await queryOne('SELECT project_no FROM projects WHERE id = ?', [projectId]);
  const pno = proj?.project_no || '';
  for (const dept of ['Production', 'QC']) {
    await notifyDepartment(dept, {
      kind: 'materials_complete', title: `All materials received — ${pno}`,
      body: 'BOM fully received — cleared to start production & inspection.',
      dedupe_key: `materials_complete:${projectId}`,
    });
  }
}

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
    // Kept even when open === 0 as long as something's Received: Production's Operations bucket
    // (bucketBomWork below) needs those rows — a project that's fully received from Procurement's
    // side is exactly the "ready to issue" state Production cares about, and open > 0 alone would
    // exclude it once every item has moved past the open D4 stages.
    .filter(p => (p.total === 0 ? depts.includes('Engineering') : (p.open > 0 || (p.stages.Received || 0) > 0)));
}

// Operations' unified cards (SYSTEM.md §3d, operations-tab-changes.md) — each BOM-owning
// department's own slice of getBomWork's shared rows, no new query. Per BOM_FIELD_OWNERS'
// field-ownership split: Engineering owns definitions (missing BOM is their concern), Procurement
// owns status/PR/PO (any open D4 stage), Stores owns GRN (Transit — goods moving, GRN pending),
// Production owns issued/received (Received — ready to issue/consume).
export function bucketBomWork(bomWork, dept) {
  switch (dept) {
    case 'Engineering': return bomWork.filter(p => p.total === 0);
    case 'Procurement': return bomWork.filter(p => p.open > 0);
    case 'Stores': return bomWork.filter(p => (p.stages.Transit || 0) > 0);
    case 'Production': return bomWork.filter(p => (p.stages.Received || 0) > 0);
    default: return [];
  }
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
            pr.pr_no, pr.created_at AS pr_created_at,
            -- STORES-SALES-CHANGES.md — Reserve alone never changes purchase_status (only Issue
            -- does), so a bom_item Stores already committed stock against otherwise looks
            -- identical to one nobody's touched. Surfaced so Procurement doesn't duplicate the
            -- sourcing work; not a status change, just visibility.
            (SELECT COALESCE(SUM(ir.qty), 0) FROM inventory_reservations ir
              WHERE ir.bom_item_id = b.id AND ir.status = 'active') AS reserved_qty
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
      -- STORES-SALES-CHANGES.md — Manual mode: a fresh line (pending_review=1) stays invisible to
      -- Procurement entirely until Stores clicks Procure (clears the flag) or Reserve (fulfills it
      -- from stock, so it never needs to appear here at all).
      -- Design-done gate: a normal project BOM line (source='bom') only reaches Procurement once
      -- Design's own 'release_bom' milestone is marked done — Procurement shouldn't be sourcing
      -- something Design hasn't actually finished releasing. Stock/sas lines (source != 'bom') point
      -- at the sentinel system project, which has no milestones at all, so they're exempt.
      WHERE (p.status = 'active' OR p.is_system = 1) AND b.pending_review = 0
        AND (b.source != 'bom' OR EXISTS (
          SELECT 1 FROM milestones m
           WHERE m.project_id = b.project_id AND m.milestone_key = 'release_bom' AND m.status = 'done'
        ))
      ORDER BY p.project_no, b.sort_order, b.id`);
}

// Operations' Stores pipeline glance (STORES-SALES-CHANGES.md) — same slot/pattern as
// getProcurementFlowCounts/getSalesFlowCounts. Two real entry points feed Stores' queue: a BOM
// line Design/Engineering releases, and a SAS trade line Sales pushes — plus Stores' own Build
// stock requests, a third, minor source. All three land in Open requests; a fresh bom/sas line
// additionally sits in Stores Review (pending_review=1, Manual mode's gate) until Stores reserves
// it or sends it to Procurement. Received is deliberately not the full Enquiry→...→Received chain
// (ProcurementFlow already owns that) — just the one terminal Stores actually cares about.
export async function getStoresFlowCounts() {
  const [openBySource, storesReview, reserved, terminal] = await Promise.all([
    queryAll(
      `SELECT b.source, COUNT(*) AS n FROM bom_items b JOIN projects p ON p.id = b.project_id
        WHERE (p.status = 'active' OR p.is_system = 1)
          AND COALESCE(b.purchase_status, 'Enquiry') NOT IN ('Received', 'Cancelled', 'In-Stock')
        GROUP BY b.source`
    ),
    queryOne(
      `SELECT COUNT(*) AS n FROM bom_items b JOIN projects p ON p.id = b.project_id
        WHERE (p.status = 'active' OR p.is_system = 1) AND b.pending_review = 1`
    ),
    queryOne("SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'active'"),
    queryAll(
      `SELECT b.purchase_status, COUNT(*) AS n FROM bom_items b JOIN projects p ON p.id = b.project_id
        WHERE (p.status = 'active' OR p.is_system = 1) AND b.purchase_status IN ('Received', 'In-Stock')
        GROUP BY b.purchase_status`
    ),
  ]);
  const bySource = Object.fromEntries(openBySource.map(r => [r.source || 'bom', r.n]));
  const byTerminal = Object.fromEntries(terminal.map(r => [r.purchase_status, r.n]));
  return {
    sas: bySource.sas || 0,
    bom: bySource.bom || 0,
    stock: bySource.stock || 0,
    requests: openBySource.reduce((a, r) => a + r.n, 0),
    storesReview: storesReview.n,
    reserved: reserved.n,
    inStock: byTerminal['In-Stock'] || 0,
    received: byTerminal['Received'] || 0,
  };
}

// Operations' Production pipeline glance (components/ProductionFlow.jsx). Two layers, both reused
// straight off existing tables/columns/statuses — nothing here recomputes logic that already lives
// elsewhere (getProductionForecast, getWorkOrderCosting, milestone-auto):
//
// 1. The primary lifecycle spine (2026-08-19 upgrade) — BOM Released → Work Order Created →
//    Route/Operations → Work Order Released → Job Cards → Material Issued/Cut → Production
//    Execution → QC/Testing/Rework → Job Cards Completed → Work Order Completed. Every node is a
//    real existing signal: projects.bom_release_revision (§5k), work_orders.status (§5l),
//    work_order_operations existence, job_cards.status scoped to work_order_id IS NOT NULL (ad hoc
//    cards are not part of this WO-driven lifecycle — they're the secondary metric below),
//    material_issues + stock_pieces.status='consumed' (§5g/§5k), qc_records (hydro test, §5g), and
//    open rework cards. work_orders.status = 'in_progress' IS "Production Execution" — same value,
//    not a parallel state invented for the diagram.
// 2. The secondary Job Card status metric (unchanged from the original pipeline) — ALL job cards,
//    work-order-linked or ad hoc, by status — since ad hoc cards skip the lifecycle spine above
//    entirely and still need to be visible somewhere.
export async function getProductionFlowCounts() {
  const [
    activeWorkOrders, cards, productionReady, woCreated, woRoute, woReleased, woExecuting, woCompleted,
    jobCardsRaised, materialIssued, piecesCut, qcOpen, changeNotes,
  ] = await Promise.all([
    queryOne("SELECT COUNT(*) AS c FROM work_orders WHERE status IN ('released', 'in_progress')"),
    queryAll(
      `SELECT jc.status, jc.work_order_id, jc.rework_of_job_card_id FROM job_cards jc
         LEFT JOIN projects p ON p.id = jc.project_id
        WHERE jc.project_id IS NULL OR p.status = 'active'`
    ),
    // Production Ready (2026-08-19 relaunch) — project-level readiness, not a BOM-line count: every
    // line released at the project's current bom_release_revision (§5k) must have reached a real
    // terminal purchase_status. Reuses lib/bom-fields.mjs's own EXIT_STAGES vocabulary ('Received'
    // — the terminal end of ACTIVE_STAGES — plus 'In-Stock'/'Cancelled') rather than inventing a
    // parallel "ready" definition; the inner EXISTS guards against a released-but-empty baseline
    // vacuously counting as ready.
    queryOne(
      `SELECT COUNT(*) AS c FROM projects p
        WHERE p.status = 'active' AND p.bom_release_revision > 0
          AND EXISTS (SELECT 1 FROM bom_items b WHERE b.project_id = p.id AND b.released_at_revision = p.bom_release_revision)
          AND NOT EXISTS (
            SELECT 1 FROM bom_items b WHERE b.project_id = p.id AND b.released_at_revision = p.bom_release_revision
              AND COALESCE(b.purchase_status, 'Enquiry') NOT IN ('Received', 'In-Stock', 'Cancelled')
          )`
    ),
    queryOne("SELECT COUNT(*) AS c FROM work_orders WHERE status = 'draft'"),
    queryOne(
      `SELECT COUNT(*) AS c FROM work_orders wo WHERE wo.status IN ('draft', 'released')
         AND EXISTS (SELECT 1 FROM work_order_operations WHERE work_order_id = wo.id)`
    ),
    queryOne("SELECT COUNT(*) AS c FROM work_orders WHERE status = 'released'"),
    queryOne("SELECT COUNT(*) AS c FROM work_orders WHERE status = 'in_progress'"),
    queryOne("SELECT COUNT(*) AS c FROM work_orders WHERE status = 'completed'"),
    queryOne("SELECT COUNT(*) AS c FROM job_cards WHERE work_order_id IS NOT NULL AND status = 'pending'"),
    queryOne(
      `SELECT COUNT(*) AS c FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
         JOIN projects p ON p.id = b.project_id WHERE p.status = 'active'`
    ),
    queryOne("SELECT COUNT(*) AS c FROM stock_pieces WHERE status = 'consumed'"),
    queryOne(
      `SELECT COUNT(*) AS c FROM qc_records q JOIN projects p ON p.id = q.project_id
        WHERE p.status = 'active' AND q.test_type = 'hydro_test' AND q.result = 'pending'`
    ),
    queryOne("SELECT COUNT(*) AS c FROM work_order_change_notes"),
  ]);

  const counts = { workOrders: activeWorkOrders.c, adhoc: 0, pending: 0, progress: 0, done: 0, rework: 0 };
  let reworkOpenOnWo = 0;
  for (const c of cards) {
    if (c.status === 'pending') counts.pending++;
    else if (c.status === 'progress') counts.progress++;
    else if (c.status === 'done') counts.done++;
    if (!c.work_order_id && c.status !== 'done') counts.adhoc++;
    if (c.rework_of_job_card_id && c.status !== 'done') {
      counts.rework++;
      if (c.work_order_id) reworkOpenOnWo++;
    }
  }

  // Seven primary stages (2026-08-19 relaunch) — Route/Operations, Material, Labour, Costing,
  // Forecasting, and Change Notes are supporting/control layers around this, not separate primary
  // stages (counts.route/material/changeNotes below, plus the existing Forecast/Costing links —
  // Labour has no cheap existing aggregate to reuse, so it stays a plain link, same precedent
  // Costing already used). Each stage carries the work_orders.status filter value where one applies
  // so the UI can link straight into WorkOrdersPanel's existing `?status=` support
  // (app/api/work-orders/route.js already reads it) instead of a new filtered view.
  counts.lifecycle = {
    productionReady: { value: productionReady.c, href: '/projects' },
    workOrderCreated: { value: woCreated.c, href: '/production/workers?tab=workorders&wostatus=draft' },
    workOrderReleased: { value: woReleased.c, href: '/production/workers?tab=workorders&wostatus=released' },
    jobCards: { value: jobCardsRaised.c, href: '/production/workers?tab=jobcards' },
    execution: { value: woExecuting.c, href: '/production/workers?tab=workorders&wostatus=in_progress' },
    qc: { value: qcOpen.c + reworkOpenOnWo, href: '/production/workers?tab=jobcards' },
    completed: { value: woCompleted.c, href: '/production/workers?tab=workorders&wostatus=completed' },
  };
  counts.route = { value: woRoute.c, href: '/production/workers?tab=workorders&wostatus=draft' };
  counts.material = { value: materialIssued.c + piecesCut.c, href: '/production/workers?tab=bom' };
  counts.changeNotes = changeNotes.c;
  return counts;
}

// Project picker for the PR composer (Group 5 Bundle A) — id/label only, no rollups needed.
export async function getActiveProjectsList() {
  // series + created_at are additive for the QC workspace (series filter, latest-first ordering);
  // existing callers ignore them. Kept ordered by project_no here for those callers — the QC
  // workspace re-sorts latest-first client-side.
  return queryAll(
    "SELECT id, project_no, customer_name, series, created_at FROM projects WHERE status = 'active' ORDER BY project_no");
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
    calcSheets.push({ id: s.id, name: s.name, csNo: s.cs_no, status, latestSnapshotAt: latest?.ts || null });
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

// Scope of Supply / Work Order — a real document now (client block + priced line items + totals),
// matching the client's own Order Acknowledgement paper form, not just a title+spec blob. Shared
// by Design and Engineering, see app/api/scope-of-supply/route.js for the create/edit side and
// lib/sos-pdf.js for the printable version.
export async function getScopeOfSupply(projectId) {
  const headers = await queryAll('SELECT * FROM scope_of_supply WHERE project_id = ? ORDER BY created_at', [projectId]);
  if (!headers.length) return [];

  const items = await queryAll(
    `SELECT i.* FROM scope_of_supply_items i
       JOIN scope_of_supply s ON s.id = i.scope_of_supply_id
      WHERE s.project_id = ? ORDER BY i.sort_order, i.id`, [projectId]);
  const itemsByHeader = {};
  items.forEach(i => { (itemsByHeader[i.scope_of_supply_id] ||= []).push(i); });

  // Client block + commercial refs (Job No/Offer/GST) come off the project's own customer + quote
  // chain — real data already tracked elsewhere, not duplicated onto every scope_of_supply row.
  const project = await queryOne('SELECT customer_id, sale_order_id, project_no FROM projects WHERE id = ?', [projectId]);
  const customer = project?.customer_id ? await queryOne('SELECT * FROM customers WHERE id = ?', [project.customer_id]) : null;
  const saleOrder = project?.sale_order_id ? await queryOne('SELECT * FROM sale_orders WHERE id = ?', [project.sale_order_id]) : null;
  const quotation = saleOrder?.quotation_id ? await queryOne('SELECT quotation_no, quotation_date FROM quotations WHERE id = ?', [saleOrder.quotation_id]) : null;

  return headers.map(h => {
    const hItems = itemsByHeader[h.id] || [];
    const basicTotal = hItems.reduce((a, i) => a + (i.amount || 0), 0);
    const taxAmount = basicTotal * (h.tax_pct || 0) / 100;
    return {
      ...h, items: hItems,
      basicTotal, taxAmount, grandTotal: basicTotal + taxAmount,
      jobNo: project?.project_no, customer, soNo: saleOrder?.so_no,
      offerNo: quotation?.quotation_no, offerDate: quotation?.quotation_date,
    };
  });
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

// Dispatch's own unified-card "work" query — same bespoke-per-department shape as getDesignWork()
// (Dispatch's real unit of work is packing readiness, not the four BOM-owning departments' shared
// purchase_status buckets, so it doesn't fit getBomWork()/bucketBomWork()). Readiness predicate is
// the exact one getProjectBom() already uses (requires_manufacturing/production_done/purchase_status)
// — applied here across every active project rather than one project at a time.
export async function getDispatchWork() {
  const [projects, bomItems, packingItemStatus, lists] = await Promise.all([
    queryAll("SELECT id, project_no, customer_name FROM projects WHERE status = 'active'"),
    queryAll("SELECT id, project_id, purchase_status, requires_manufacturing, production_done FROM bom_items WHERE purchase_status != 'Cancelled'"),
    queryAll(`SELECT pi.bom_item_id, pl.status FROM packing_items pi
                JOIN packing_lists pl ON pl.id = pi.packing_list_id
               WHERE pi.bom_item_id IS NOT NULL`),
    queryAll('SELECT project_id, status FROM packing_lists'),
  ]);
  const dispatchedIds = new Set(packingItemStatus.filter((r) => r.status === 'dispatched').map((r) => r.bom_item_id));
  const carriedIds = new Set(packingItemStatus.map((r) => r.bom_item_id));
  const bomByProject = {};
  bomItems.forEach((b) => { (bomByProject[b.project_id] ||= []).push(b); });
  const listsByProject = {};
  lists.forEach((l) => { (listsByProject[l.project_id] ||= []).push(l); });

  return projects.map((p) => {
    const items = bomByProject[p.id] || [];
    const projLists = listsByProject[p.id] || [];
    const done = items.filter((b) => dispatchedIds.has(b.id)).length;
    const readyNotCarried = items.filter((b) => !carriedIds.has(b.id) &&
      (b.requires_manufacturing ? b.production_done : (b.purchase_status === 'Received' || b.purchase_status === 'In-Stock'))
    ).length;
    return {
      id: p.id, project_no: p.project_no, customer_name: p.customer_name,
      dispatchProgress: { done, total: items.length },
      bottleneck: readyNotCarried > 0 ? `${readyNotCarried} item${readyNotCarried !== 1 ? 's' : ''} ready to pack` : null,
      listsStatus: { done: projLists.filter((l) => l.status === 'dispatched').length, total: projLists.length },
      hasActivity: items.length > 0 || projLists.length > 0,
    };
  }).filter((p) => p.hasActivity);
}

// Dispatch's Pending Items tab — a real cross-project, item-level worklist, same shape as
// getSourcingItems() (Procurement's own cross-project worklist): flat bom_items join projects,
// filtered to active, ordered by project. Deliberately NOT status-scoped on the packing_items join
// (no packing_lists.status filter) — must match the exact "already on ANY list, draft included"
// definition /api/packing/from-bom's dedup guard uses, so this list never shows an item that
// clicking Generate Draft would then refuse to add.
export async function getPendingPackingItems() {
  const rows = await queryAll(
    `SELECT b.id, b.material_description, b.qty_text, b.moc, b.size_spec,
            b.purchase_status, b.requires_manufacturing, b.production_done,
            p.id AS project_id, p.project_no, p.customer_name
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
      WHERE p.status = 'active'
        AND b.purchase_status != 'Cancelled'
        AND b.id NOT IN (SELECT bom_item_id FROM packing_items WHERE bom_item_id IS NOT NULL)
      ORDER BY p.project_no, b.sort_order, b.id`);
  // readyForPacking mirrors getProjectBom()'s exact predicate — never a second, independently-
  // drifting definition of "ready."
  return rows.map((b) => ({
    ...b,
    readyForPacking: b.requires_manufacturing
      ? !!b.production_done
      : (b.purchase_status === 'Received' || b.purchase_status === 'In-Stock'),
  }));
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
  return derivePurchaseStage(it).toLowerCase();
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

// V2-CHANGES.md Group 6 Phase 6.1 — Sales' simple Sale Order list (D14; so_no is minted
// SO-{seq} now, both on plain create and the quotation-convert path — see app/api/sale-orders).
// project_id: whether a Project already exists for this SO (STORES-SALES-CHANGES.md §2b's
// Sales→PM handoff gap) — lets the UI hide "Convert to Project" once one has been created.
export async function getSaleOrders() {
  // item_count is additive (existing callers ignore it) — it's the real "ready for a Project"
  // signal a bare header-only SO doesn't have yet: an SO only carries real sale_order_items once
  // it came through the Quotation→convert flow (which copies priced lines and already notifies
  // Design + PMs at that moment), not the quick-add "New Sale Order" dialog, which is a
  // placeholder header for the lighter-weight SAS/trade-request use case (§5e) and was never meant
  // to seed a Scope of Supply on its own.
  return queryAll(
    `SELECT so.*, p.id AS project_id,
            (SELECT COUNT(*) FROM sale_order_items soi WHERE soi.sale_order_id = so.id) AS item_count
       FROM sale_orders so
       LEFT JOIN projects p ON p.sale_order_id = so.id
      ORDER BY so.created_at DESC`
  );
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

// Operations' Sales pipeline glance (STORES-SALES-CHANGES.md follow-up) — same slot/precedent as
// getProcurementFlowCounts/getDesignFlowCounts. Stages are the real Sales workspace tabs, not the
// separate opportunities/Pipeline stage set (getOpportunityPipelineCounts already covers that for
// Executive 360) — this one tracks Leads → Quotations → Sale Orders → Projects instead.
export async function getSalesFlowCounts() {
  const [leads, quotations, saleOrders] = await Promise.all([
    queryAll('SELECT status FROM leads'),
    queryAll('SELECT status FROM quotations'),
    queryAll('SELECT so.status, p.id AS project_id FROM sale_orders so LEFT JOIN projects p ON p.sale_order_id = so.id'),
  ]);
  return {
    leads: leads.filter(l => !['converted', 'lost'].includes(l.status)).length,
    quotations: quotations.filter(q => ['draft', 'sent'].includes(q.status)).length,
    sale_orders: saleOrders.filter(so => so.status === 'open').length,
    projects: saleOrders.filter(so => so.project_id).length,
  };
}

// Accounts Operations tab glance (components/AccountsFlow.jsx) — three converging spines rather
// than one, since Accounts isn't a single pipeline: Purchase-to-Pay (vendor bills), Order-to-Cash
// (sales invoices), and Period Close (journal entries), all terminating at the General Ledger tab.
// Global across companies, same as every other getXFlowCounts here.
export async function getAccountsFlowCounts() {
  const [bills, debitNotes, invoices, creditNotes, jeStatus, bankLines, gstFilings] = await Promise.all([
    queryAll("SELECT status, COUNT(*) AS n FROM vendor_bills GROUP BY status"),
    queryOne("SELECT COUNT(*) AS n FROM purchase_debit_notes"),
    queryAll("SELECT status, COUNT(*) AS n FROM sales_invoices GROUP BY status"),
    queryOne("SELECT COUNT(*) AS n FROM sales_credit_notes"),
    queryAll("SELECT status, COUNT(*) AS n FROM journal_entries GROUP BY status"),
    queryAll("SELECT jel.reconciled, COUNT(*) AS n FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE je.status = 'posted' AND coa.code = '1001' GROUP BY jel.reconciled"),
    queryOne("SELECT COUNT(*) AS n FROM gst_filings"),
  ]);
  const byBillStatus = Object.fromEntries(bills.map(r => [r.status, r.n]));
  const byInvoiceStatus = Object.fromEntries(invoices.map(r => [r.status, r.n]));
  const byJeStatus = Object.fromEntries(jeStatus.map(r => [r.status, r.n]));
  const byReconciled = Object.fromEntries(bankLines.map(r => [r.reconciled ? 'yes' : 'no', r.n]));
  return {
    billsDraft: byBillStatus.draft || 0,
    billsApproved: byBillStatus.approved || 0,
    billsPaid: byBillStatus.paid || 0,
    debitNotes: debitNotes.n,
    invoicesDraft: byInvoiceStatus.draft || 0,
    invoicesIssued: byInvoiceStatus.issued || 0,
    invoicesPaid: byInvoiceStatus.paid || 0,
    creditNotes: creditNotes.n,
    jeDraft: byJeStatus.draft || 0,
    jePosted: byJeStatus.posted || 0,
    reconciled: byReconciled.yes || 0,
    gstFilings: gstFilings.n,
  };
}

// Operations' Dispatch pipeline glance (components/DispatchFlow.jsx, SYSTEM.md §3d). The plainest
// case of the pattern — one table, one status column, three literal values, no branch/terminal
// concept (a packing list is never cancelled in this schema) — same straight-spine shape DesignFlow
// uses, just three boxes instead of five.
export async function getDispatchFlowCounts() {
  const rows = await queryAll("SELECT status, COUNT(*) AS n FROM packing_lists GROUP BY status");
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return {
    pending: byStatus.draft || 0,
    ready: byStatus.packed || 0,
    dispatched: byStatus.dispatched || 0,
  };
}

// Operations' Installation pipeline glance (components/InstallationFlow.jsx, SYSTEM.md §3d).
// service_calls.status is a real enforced 5-state machine (app/api/service-calls/[id]/route.js's
// STATUSES array) — the only genuine sequential lifecycle Installation owns. Service Contracts is
// deliberately NOT a second spine here: a contract's real states (active/expired/renewed/cancelled)
// are terminal outcomes, not forward progress, and 'renewed' inserts a brand-new contract row
// instead of advancing the same one (§5n) — so it surfaces as small count badges instead.
export async function getInstallationFlowCounts() {
  const [calls, contracts] = await Promise.all([
    queryAll("SELECT status FROM service_calls"),
    queryAll("SELECT status, end_date FROM service_contracts"),
  ]);
  const byStatus = Object.fromEntries(
    ['open', 'assigned', 'in_progress', 'resolved', 'closed'].map(s => [s, 0])
  );
  for (const c of calls) if (byStatus[c.status] != null) byStatus[c.status]++;
  const in30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...byStatus,
    contractsActive: contracts.filter(c => c.status === 'active' && (!c.end_date || c.end_date > in30d)).length,
    contractsExpiringSoon: contracts.filter(c => c.status === 'active' && c.end_date && c.end_date >= today && c.end_date <= in30d).length,
    contractsRenewed: contracts.filter(c => c.status === 'renewed').length,
    contractsClosedOut: contracts.filter(c => c.status === 'expired' || c.status === 'cancelled').length,
  };
}

// Operations' HR pipeline glance (components/HrFlow.jsx, SYSTEM.md §3d). Headcount lifecycle only —
// the one HR workflow shaped like the other Flow diagrams' sequential spine. Recruitment
// (job_applicants funnel) and payroll runs (draft/processed/submitted) are real pipelines too but
// conceptually separate from "is this person onboarding, active, leaving, or gone" — left as
// candidates for their own smaller widgets later, not bolted onto this spine.
export async function getHrFlowCounts() {
  const [onboarding, active, separation, exited] = await Promise.all([
    queryOne("SELECT COUNT(*) AS c FROM employee_onboarding WHERE status = 'in_progress'"),
    queryOne(
      `SELECT COUNT(*) AS c FROM employees e WHERE e.active = 1
         AND NOT EXISTS (SELECT 1 FROM employee_onboarding o WHERE o.employee_id = e.id AND o.status = 'in_progress')`
    ),
    queryOne("SELECT COUNT(*) AS c FROM employee_separation WHERE status = 'in_progress'"),
    queryOne("SELECT COUNT(*) AS c FROM employees WHERE active = 0"),
  ]);
  return { onboarding: onboarding.c, active: active.c, separation: separation.c, exited: exited.c };
}

// Operations' Engineering pipeline glance (components/EngineeringFlow.jsx, SYSTEM.md §3d).
// Deliberately the smallest of all six flow diagrams: bom_change_notes.status is Engineering's only
// real state machine (a 3-way pending/approved/rejected split), not a multi-stage spine — BOM
// structure building, Where-Used, and Common/Uncommon are tree/classification views with no forward
// progression, so they're excluded rather than turned into invented stages. Calc Sheets (Design's
// own pipeline, shared /calc tab) is untouched — this covers Engineering's own ECN data only.
export async function getEngineeringFlowCounts() {
  const rows = await queryAll("SELECT status, COUNT(*) AS n FROM bom_change_notes GROUP BY status");
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return {
    pending: byStatus.pending || 0,
    approved: byStatus.approved || 0,
    rejected: byStatus.rejected || 0,
  };
}

// Operations' QC pipeline glance (components/QcFlow.jsx, SYSTEM.md §3d). The statutory-document
// pipeline (test_certificates -> certificate_projects -> qc_document_parts linking -> finalized) is
// the one QC pipeline with real sequential depth, read cross-project (matches /qc's own scope).
// qc_records (hydro test/NDE/MTC results) is a flat pending/pass/fail tally, not a multi-stage
// lifecycle — it rides along as a secondary row, same precedent as ProductionFlow's secondary spine,
// rather than being stretched into fake "stages" on the main one.
export async function getQcFlowCounts() {
  const [certTotal, certAllocated, docsTotal, docsUnlinked, records] = await Promise.all([
    queryOne("SELECT COUNT(*) AS c FROM test_certificates"),
    queryOne("SELECT COUNT(DISTINCT certificate_id) AS c FROM certificate_projects"),
    queryOne("SELECT COUNT(*) AS c FROM qc_documents"),
    queryOne(
      `SELECT COUNT(*) AS c FROM qc_documents d
        WHERE EXISTS (SELECT 1 FROM qc_document_parts WHERE document_id = d.id AND test_certificate_id IS NULL)`
    ),
    queryAll("SELECT result FROM qc_records"),
  ]);
  return {
    uploaded: certTotal.c - certAllocated.c,
    allocated: certAllocated.c,
    inProgress: docsUnlinked.c,
    finalized: docsTotal.c - docsUnlinked.c,
    recordsPending: records.filter(r => r.result === 'pending').length,
    recordsPassed: records.filter(r => r.result === 'pass').length,
    recordsFailed: records.filter(r => r.result === 'fail').length,
  };
}

// V2-CHANGES.md Group 6 Phase 6.2/6.3 (D8) — Stores' inventory workbench. `available` nets out
// every *active* reservation (Phase 6.3) so no two requests can ever draw the same physical units —
// on_hand alone would let that happen. Small table at this company's scale (built up materials, not
// a warehouse's full SKU list), one query, client-side low-stock/search filtering downstream.
export async function getInventoryItems() {
  return queryAll(
    `SELECT i.*,
            i.on_hand - COALESCE((SELECT SUM(r.qty) FROM inventory_reservations r
                                    WHERE r.inventory_item_id = i.id AND r.status = 'active'), 0) AS available,
            it.item_code AS catalog_item_code, it.uom AS catalog_uom
       FROM inventory_items i
       LEFT JOIN items it ON it.id = i.item_id
      ORDER BY i.description`
  );
}

// Smart code lookup (2026-08-26) — Stores' Inventory search only ever matched description/item_code
// (INV-####), so typing a physical piece code (PL-/LN-), a serial code (SR-), or the catalog's own
// code (IM-####) returned nothing even though that exact identifier is real and visible elsewhere in
// the app. Resolves any of the three to the ONE inventory_items row that owns it, so the client can
// fall back to this when its local description/item_code filter finds nothing. Deliberately not a
// fuzzy search — an exact code is either real or it isn't; a typo should show "not found," not a
// guess.
export async function findInventoryItemIdByCode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  let row = await queryOne('SELECT inventory_item_id FROM stock_pieces WHERE code = ?', [c]);
  if (row) return row.inventory_item_id;
  row = await queryOne('SELECT inventory_item_id FROM inventory_serials WHERE code = ?', [c]);
  if (row) return row.inventory_item_id;
  row = await queryOne(
    `SELECT i.id AS inventory_item_id FROM inventory_items i
       JOIN items it ON it.id = i.item_id WHERE it.item_code = ?`, [c]);
  if (row) return row.inventory_item_id;
  return null;
}

// Stores' own read of open requests — Stores can't see Procurement's Enquiry tab, so the Reserve
// action needs its own list. Any source (bom/stock/sas), any project including the sentinel one
// (Phase 6.4). NOT IN with a COALESCE default, not isOpenStatus's Set client-side, since this is a
// SQL WHERE — same NULL-safety idiom getPurchaseOrders' fulfilled-check already learned the hard
// way (SYSTEM.md §5c Phase 4: bare NOT IN silently drops NULL rows).
export async function getOpenBomItems() {
  return queryAll(
    `SELECT b.*, p.project_no, p.customer_name, p.is_system AS project_is_system,
            -- Cutting & Remnant Management — a line lib/remnant-match.js already reserved a
            -- physical piece against needs its own badge (not "Stores Review") and no Procure
            -- button: it's already fulfilled, just waiting on Production to cut it.
            (SELECT COUNT(*) FROM stock_pieces sp WHERE sp.bom_item_id = b.id AND sp.status = 'reserved') AS reserved_piece_count,
            -- Allocation redesign (2026-08-20) — the plain-quantity analog of reserved_piece_count
            -- above: a line lib/procurement.js's autoReserveFromStock already reserved needs the
            -- same "no action needed" treatment as a remnant match, not a "Stores Review" badge.
            (SELECT COALESCE(SUM(ir.qty), 0) FROM inventory_reservations ir WHERE ir.bom_item_id = b.id AND ir.status = 'active') AS reserved_qty,
            it.item_code AS catalog_item_code
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN items it ON it.id = b.item_id
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

// STERP item 9, Auto-Indent Suggestions — derived, not a stored queue: every item below its own
// minimum (same isLowStock condition StoresWorkspace.jsx already flags), excluding anything that
// already has an open source='stock' replenishment request in flight (same NOT IN/COALESCE guard
// getOpenBomItems uses) so a low item doesn't keep re-suggesting itself after Stores has already
// acted on it once. Human still clicks "Create request" — this list is the suggestion, not the ask.
export async function getReorderSuggestions() {
  return queryAll(
    `SELECT i.*,
            i.on_hand - COALESCE((SELECT SUM(r.qty) FROM inventory_reservations r
                                    WHERE r.inventory_item_id = i.id AND r.status = 'active'), 0) AS available
       FROM inventory_items i
      WHERE i.reorder_point IS NOT NULL
        AND (i.on_hand - COALESCE((SELECT SUM(r.qty) FROM inventory_reservations r
                                     WHERE r.inventory_item_id = i.id AND r.status = 'active'), 0)) <= i.reorder_point
        AND NOT EXISTS (
          SELECT 1 FROM bom_items b
           WHERE b.inventory_item_id = i.id AND b.source = 'stock'
             AND COALESCE(b.purchase_status, '${DEFAULT_PURCHASE_STATUS}') NOT IN ('Received','Cancelled','In-Stock')
        )
      ORDER BY i.description`
  );
}

// STERP item 14, Formal GIR — Gate Inward Receipt log, newest first.
export async function getGateInwardReceipts() {
  return queryAll(`SELECT * FROM gate_inward_receipts ORDER BY gir_no DESC`);
}

// STERP item 15, Gate Pass — header + its item lines, with overdue derived here (returnable,
// still out, past its expected return date) rather than stored, same reasoning as `available`
// on inventory_items: a stored flag would drift the moment "today" moves and nobody re-saves it.
export async function getGatePasses() {
  const passes = await queryAll(
    `SELECT *,
            (type = 'returnable' AND status NOT IN ('returned','cancelled')
             AND expected_return_date IS NOT NULL AND expected_return_date < date('now')) AS is_overdue
       FROM gate_passes ORDER BY gp_no DESC`
  );
  if (!passes.length) return passes;
  const items = await queryAll(
    `SELECT * FROM gate_pass_items WHERE gate_pass_id IN (${passes.map(() => '?').join(',')}) ORDER BY id`,
    passes.map(p => p.id)
  );
  const byPass = new Map();
  for (const it of items) {
    if (!byPass.has(it.gate_pass_id)) byPass.set(it.gate_pass_id, []);
    byPass.get(it.gate_pass_id).push(it);
  }
  return passes.map(p => ({ ...p, items: byPass.get(p.id) || [] }));
}

// STERP items 36/38 — Service Calls, newest first, with visit history attached (same
// batch-then-group idiom as getGatePasses above) and project_no for display.
export async function getServiceCalls() {
  const calls = await queryAll(
    `SELECT sc.*, p.project_no
       FROM service_calls sc LEFT JOIN projects p ON p.id = sc.project_id
      ORDER BY sc.call_no DESC`
  );
  if (!calls.length) return calls;
  const visits = await queryAll(
    `SELECT * FROM service_call_visits WHERE service_call_id IN (${calls.map(() => '?').join(',')}) ORDER BY visit_date DESC`,
    calls.map(c => c.id)
  );
  const byCall = new Map();
  for (const v of visits) {
    if (!byCall.has(v.service_call_id)) byCall.set(v.service_call_id, []);
    byCall.get(v.service_call_id).push(v);
  }
  return calls.map(c => ({ ...c, visits: byCall.get(c.id) || [] }));
}

// STERP item 37 — Service Contracts, newest first, with project_no for display.
export async function getServiceContracts() {
  return queryAll(
    `SELECT sc.*, p.project_no
       FROM service_contracts sc LEFT JOIN projects p ON p.id = sc.project_id
      ORDER BY sc.contract_no DESC`
  );
}

// STERP item 7/38 (Service Reports) — Installation's own milestones (Site Installation +
// Commissioning) across every project, for the milestones/delays/commissioning-completion report.
export async function getInstallationMilestones() {
  return queryAll(
    `SELECT m.*, p.project_no, p.customer_name
       FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.department = 'Installation'
      ORDER BY m.updated_at DESC`
  );
}

// Every quote ever logged, fetched once for the whole /procurement workspace — small table at this
// company's scale, and fetching it flat lets the Sourcing tab (quote counts, comparison) and the
// Suppliers tab (per-supplier history) both filter client-side instead of each needing their own
// per-item/per-supplier round trip.
// b/p joins added for the Suppliers tab's per-quote history line (was silently rendering
// "undefined" for material/project) and for Vendor Analysis (SYSTEM.md §5c) — bom_item_id/
// project_id are both NOT NULL, so these are safe inner joins, not an optional/nullable case.
export async function getAllQuotes() {
  return queryAll(
    `SELECT sq.*, s.name AS supplier_name, b.material_description, p.project_no
       FROM supplier_quotes sq
       JOIN suppliers s ON s.id = sq.supplier_id
       JOIN bom_items b ON b.id = sq.bom_item_id
       JOIN projects p ON p.id = b.project_id
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
            s.phone AS supplier_phone, s.email AS supplier_email, s.state_code AS supplier_state_code
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`, [id]);
  if (!po) return null;
  const items = await queryAll(
    `SELECT poi.*, p.project_no, p.company AS project_company FROM po_items poi
       LEFT JOIN projects p ON p.id = poi.project_id
      WHERE poi.po_id = ? ORDER BY poi.sort_order, poi.id`, [id]);
  // A PO can span projects (is_split), which could mean spanning companies too — only pick a
  // letterhead when every item traces back to the same one; otherwise fall back rather than guess.
  const companies = new Set(items.map(i => i.project_company).filter(Boolean));
  po.company = companies.size === 1 ? [...companies][0] : 'Shanti Boilers';
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
// what the "unmarked" tally counts, and what tells the card it has nothing saved. Sourced from the
// unified `employees` master (PRODUCTION-MODULE-DESIGN.md §2.5) + HR's attendance_days, not the
// frozen legacy `workers`/`worker_days` tables.
export async function getWorkerSheet(date) {
  return queryAll(
    `SELECT e.id, e.name, e.trade,
            d.status, d.project_id, d.milestone_id, d.notes
       FROM employees e
       LEFT JOIN attendance_days d ON d.employee_id = e.id AND d.date = ?
      WHERE e.department = 'Production' AND e.employee_type = 'worker' AND e.active = 1
      ORDER BY e.name`,
    [date]
  );
}

// Roster tab — inactive workers included, listed last.
export async function getWorkers() {
  return queryAll(
    "SELECT * FROM employees WHERE department = 'Production' AND employee_type = 'worker' ORDER BY active DESC, name"
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
  // No cron in this app — this is the opportunistic hook (see lib/calc.js's own comment). Cheap:
  // a no-op SELECT whenever nothing is actually due.
  await sweepDrawingNotifications();
  const [items, count] = await Promise.all([
    queryAll(
      `SELECT n.id, n.kind, n.milestone_id, n.task_id, n.title, n.body, n.read_at, n.created_at,
              COALESCE(n.project_id, m.project_id, tk.project_id) AS project_id
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

// Lead-linked notes only, lightweight columns — the Agent Performance report's "average response
// time" proxy (no first-response timestamp exists anywhere; this is the closest real signal: the
// earliest note logged against a lead, computed client-side same as every other CRM report here).
export async function getLeadNotes() {
  return queryAll('SELECT id, lead_id, created_by, created_at FROM crm_notes WHERE lead_id IS NOT NULL ORDER BY created_at');
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

// STERP "Sales Costing" (SYSTEM.md §5e) — post-sale actual cost vs. quoted value, on the Project
// (Sales Costing was answered as "post-sale, phased" — a pre-sale cost estimate on the Quotation
// is deliberately not built: no real BOM/PO/labor data exists before a Project does, so an
// estimate that early would need to be hand-entered, not derived. If that phase gets picked up
// later, it needs its own manual-estimate entity — do not extend this function to fake it).
// materialCost only counts issued POs (real committed spend, same convention Suppliers → Analysis
// already uses) — draft/cancelled POs aren't real cost yet.
// workOrderId (optional, STERP "Work Order Costing" item 29, §5l) scopes the labor figure to one
// Work Order's own job cards instead of the whole project — reused by getWorkOrderCosting below
// rather than duplicating this query. Material stays project-scoped: POs aren't raised per-WO in
// this app, only per-project, so a WO's material actual is honestly the project's, not invented.
export async function getProjectCosting(projectId, workOrderId = null) {
  const [material, labor, project] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(pi.amount), 0) AS v FROM po_items pi
         JOIN purchase_orders po ON po.id = pi.po_id
        WHERE pi.project_id = ? AND po.status = 'issued'`, [projectId]),
    queryOne(
      `SELECT COALESCE(SUM(t.minutes / 60.0 * e.cost_rate_per_hour), 0) AS v FROM job_card_time_logs t
         JOIN job_cards jc ON jc.id = t.job_card_id
         JOIN employees e ON e.id = t.employee_id
        WHERE jc.project_id = ? ${workOrderId ? 'AND jc.work_order_id = ?' : ''}`,
      workOrderId ? [projectId, workOrderId] : [projectId]),
    queryOne(
      `SELECT so.total AS selling_value FROM projects p
         JOIN sale_orders so ON so.id = p.sale_order_id
        WHERE p.id = ?`, [projectId]),
  ]);
  const materialCost = material.v;
  const laborCost = labor.v;
  const totalCost = materialCost + laborCost;
  const sellingValue = project?.selling_value || 0;
  const margin = sellingValue - totalCost;
  return {
    materialCost, laborCost, totalCost, sellingValue, margin,
    marginPct: sellingValue ? Math.round((margin / sellingValue) * 100) : null,
  };
}

// Report Engine — Management reports (2026-08-22, cross-department, /executive/reports). Reuses
// getProjectCosting() (already the tested material+labor-vs-selling-value calc, above) rather than
// a second cost rollup — loops it across every project in a period, same "loop the existing
// per-record compute" pattern this session's Production Cost Variance report already established.
export async function getProjectProfitabilityLines(company, { from, to } = {}) {
  const conditions = ['company = ?', 'is_system = 0'];
  const args = [company];
  if (from) { conditions.push('date(created_at) >= ?'); args.push(from); }
  if (to) { conditions.push('date(created_at) <= ?'); args.push(to); }
  const projects = await queryAll(
    `SELECT id, project_no, customer_name, created_at FROM projects WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    args
  );
  const lines = [];
  for (const p of projects) {
    const costing = await getProjectCosting(p.id);
    lines.push({ ...p, ...costing });
  }
  return lines;
}

// Customer Profitability — same margin data as Project Profitability, grouped by customer instead
// of project (who's actually profitable to work with, not just which job).
export async function getCustomerProfitabilityLines(company, { from, to } = {}) {
  const projectLines = await getProjectProfitabilityLines(company, { from, to });
  const byCustomer = new Map();
  for (const p of projectLines) {
    const key = p.customer_name || 'Unknown';
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { customer_name: key, projectCount: 0, materialCost: 0, laborCost: 0, totalCost: 0, sellingValue: 0, margin: 0 });
    }
    const c = byCustomer.get(key);
    c.projectCount += 1;
    c.materialCost += p.materialCost;
    c.laborCost += p.laborCost;
    c.totalCost += p.totalCost;
    c.sellingValue += p.sellingValue;
    c.margin += p.margin;
  }
  return [...byCustomer.values()]
    .map((c) => ({ ...c, marginPct: c.sellingValue ? Math.round((c.margin / c.sellingValue) * 100) : null }))
    .sort((a, b) => b.margin - a.margin);
}

// Procurement Spend — getPurchaseRegisterLines() grouped by supplier instead of listed per bill;
// same underlying query, no new SQL.
export async function getProcurementSpendLines(company, { from, to } = {}) {
  const bills = await getPurchaseRegisterLines(company, { from, to });
  const bySupplier = new Map();
  for (const b of bills) {
    const key = b.supplier_name;
    if (!bySupplier.has(key)) bySupplier.set(key, { supplier_name: key, billCount: 0, subtotal: 0, taxAmount: 0, payable: 0 });
    const s = bySupplier.get(key);
    s.billCount += 1;
    s.subtotal += b.subtotal;
    s.taxAmount += b.tax_amount;
    s.payable += b.payable_amount;
  }
  return [...bySupplier.values()].sort((a, b) => b.payable - a.payable);
}

// STERP "Sales Returns" (SYSTEM.md §5e) — small table, same flat-select idiom as the rest of CRM.
export async function getSalesReturns() {
  return queryAll(`
    SELECT sr.*, so.so_no, so.customer_name, i.description AS inventory_description
      FROM sales_returns sr
      JOIN sale_orders so ON so.id = sr.sale_order_id
      LEFT JOIN inventory_items i ON i.id = sr.inventory_item_id
     ORDER BY sr.created_at DESC
  `);
}

// STERP "Price Lists" (SYSTEM.md §5e) — customer_name NULL means the row is a default rate open
// to every customer, not a query bug; the management tab reads that directly. Small table at this
// company's scale, same "one flat select, client-side grouping" idiom as the rest of this file.
export async function getPriceLists() {
  return queryAll(`
    SELECT pl.*, c.name AS customer_name, i.item_name, i.item_code, i.uom AS item_uom
      FROM price_lists pl
      LEFT JOIN customers c ON c.id = pl.customer_id
      JOIN items i ON i.id = pl.item_id
     ORDER BY i.item_name, (pl.customer_id IS NULL), pl.valid_from DESC
  `);
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

// Production-owned skill list — see the `trades` table comment (lib/db.js) for why this is a
// separate axis from designation.
export async function getTrades() {
  return queryAll('SELECT * FROM trades WHERE active = 1 ORDER BY name');
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

// insertProfessionalTaxSlab/insertIncomeTaxSlab/insertGstRate/insertVendorTdsRate (below) each
// dedupe on their natural key before inserting — hub rate-sync (lib/rate-sync.js) can legitimately
// re-request the same already-applied batch after a later row in it throws (the sync only advances
// hub_sync_state.cursor once the whole batch succeeds), so a retry must be a no-op on rows already
// landed, not a duplicate. An exact-match guard only — a genuinely different payload for the same
// identity (e.g. a corrected threshold at the same effective_from) still inserts as a new row,
// matching how these tables are already versioned (insert, never update-in-place).
export async function insertProfessionalTaxSlab({ state, min_gross, max_gross, amount }) {
  if (!state || min_gross == null || amount == null) {
    throw new Error('state, min_gross, amount are required');
  }
  const existing = await queryOne(
    'SELECT id FROM professional_tax_slabs WHERE state = ? AND min_gross = ? AND max_gross IS ? AND amount = ?',
    [state, min_gross, max_gross ?? null, amount]
  );
  if (existing) return existing.id;
  const { lastId } = await execute(
    'INSERT INTO professional_tax_slabs (state, min_gross, max_gross, amount) VALUES (?, ?, ?, ?)',
    [state, min_gross, max_gross ?? null, amount]
  );
  return Number(lastId);
}

export async function insertIncomeTaxSlab({ financial_year, min_income, max_income, rate_pct }) {
  if (!financial_year || min_income == null || rate_pct == null) {
    throw new Error('financial_year, min_income, rate_pct are required');
  }
  const existing = await queryOne(
    "SELECT id FROM income_tax_slabs WHERE regime = 'new' AND financial_year = ? AND min_income = ? AND max_income IS ? AND rate_pct = ?",
    [financial_year, min_income, max_income ?? null, rate_pct]
  );
  if (existing) return existing.id;
  const { lastId } = await execute(
    "INSERT INTO income_tax_slabs (regime, financial_year, min_income, max_income, rate_pct) VALUES ('new', ?, ?, ?, ?)",
    [financial_year, min_income, max_income ?? null, rate_pct]
  );
  return Number(lastId);
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
    `SELECT s.*, e.name AS employee_name, e.employee_code, e.bank_name, e.bank_account_no, e.bank_ifsc, e.company
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

// ---- Production: Job Cards (PRODUCTION-MODULE-DESIGN.md) ----

export async function getOperations() {
  return queryAll('SELECT * FROM operations WHERE active = 1 ORDER BY name');
}

export async function getWorkstations() {
  return queryAll('SELECT * FROM workstations WHERE active = 1 ORDER BY name');
}

// Board + list query. Time-log hours and assigned worker names are aggregated in JS from a second
// query rather than SQL string-aggregation (GROUP_CONCAT dialect differences) — small tables,
// cheap either way, and easier to read.
export async function getJobCards({ projectId, status, workOrderId } = {}) {
  const where = [];
  const args = [];
  if (projectId) { where.push('jc.project_id = ?'); args.push(Number(projectId)); }
  if (status) { where.push('jc.status = ?'); args.push(status); }
  if (workOrderId) { where.push('jc.work_order_id = ?'); args.push(Number(workOrderId)); }
  const cards = await queryAll(
    // LEFT JOIN projects, not JOIN — an against_stock Work Order's generated cards have no project
    // (§5l, job_cards.project_id is nullable) and would otherwise silently vanish from the board.
    `SELECT jc.*, p.project_no, p.customer_name, o.name AS operation_name, w.name AS workstation_name,
            wo.wo_no, wo.product_description AS wo_product_description
       FROM job_cards jc
       LEFT JOIN projects p ON p.id = jc.project_id
       LEFT JOIN operations o ON o.id = jc.operation_id
       LEFT JOIN workstations w ON w.id = jc.workstation_id
       LEFT JOIN work_orders wo ON wo.id = jc.work_order_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY jc.status, jc.planned_start, jc.id`,
    args
  );
  if (!cards.length) return cards;
  const logs = await queryAll(
    `SELECT tl.job_card_id, tl.minutes, e.name AS employee_name
       FROM job_card_time_logs tl JOIN employees e ON e.id = tl.employee_id
      WHERE tl.job_card_id IN (${cards.map(() => '?').join(',')})`,
    cards.map(c => c.id)
  );
  const byCard = {};
  for (const l of logs) {
    const bucket = (byCard[l.job_card_id] ||= { minutes: 0, workers: new Set() });
    bucket.minutes += l.minutes || 0;
    bucket.workers.add(l.employee_name);
  }
  return cards.map(c => ({
    ...c,
    hours_logged: Math.round(((byCard[c.id]?.minutes || 0) / 60) * 10) / 10,
    workers: [...(byCard[c.id]?.workers || [])],
  }));
}

export async function getJobCardDetail(id) {
  const card = await queryOne(
    `SELECT jc.*, p.project_no, p.customer_name, o.name AS operation_name, w.name AS workstation_name,
            wo.wo_no, wo.product_description AS wo_product_description
       FROM job_cards jc
       LEFT JOIN projects p ON p.id = jc.project_id
       LEFT JOIN operations o ON o.id = jc.operation_id
       LEFT JOIN workstations w ON w.id = jc.workstation_id
       LEFT JOIN work_orders wo ON wo.id = jc.work_order_id
      WHERE jc.id = ?`,
    [id]
  );
  if (!card) return null;
  const [timeLogsRaw, consumables, materialIssues] = await Promise.all([
    queryAll(
      `SELECT tl.*, e.name AS employee_name, e.cost_rate_per_hour FROM job_card_time_logs tl
        JOIN employees e ON e.id = tl.employee_id WHERE tl.job_card_id = ? ORDER BY tl.created_at DESC`,
      [id]
    ),
    queryAll('SELECT * FROM job_card_consumables WHERE job_card_id = ? ORDER BY created_at DESC', [id]),
    queryAll('SELECT * FROM material_issues WHERE job_card_id = ? ORDER BY issued_at DESC', [id]),
  ]);
  // Labor cost (§3.6) — Σ minutes/60 × the logging employee's rate at query time. Rate is HR-owned
  // and can change; this is always "cost at today's rate," not a frozen historical figure — fine
  // for a shop-floor glance, not for finance close.
  let laborCost = 0;
  const timeLogs = timeLogsRaw.map(l => {
    const cost = l.cost_rate_per_hour ? Math.round((l.minutes / 60) * l.cost_rate_per_hour * 100) / 100 : null;
    if (cost) laborCost += cost;
    return { ...l, cost };
  });
  return { ...card, timeLogs, consumables, materialIssues, laborCost: Math.round(laborCost * 100) / 100 };
}

// Fabrication % per subsystem for a project — job-card completion, the payoff rollup (§3.4).
// qty_planned=0 cards (not yet estimated) don't count toward the denominator.
export async function getFabricationProgress(projectId) {
  const rows = await queryAll(
    `SELECT section, SUM(qty_planned) AS planned, SUM(qty_done) AS done
       FROM job_cards WHERE project_id = ? AND qty_planned > 0 GROUP BY section ORDER BY section`,
    [Number(projectId)]
  );
  return rows.map(r => ({
    section: r.section,
    planned: r.planned,
    done: r.done,
    pct: r.planned ? Math.round((r.done / r.planned) * 100) : 0,
  }));
}

// --- Work Orders (STERP items 21-23, 27-29 — SYSTEM.md §5l) --------------------------------------
// The parent production-control entity above Job Cards (§5g): a Work Order references a project's
// BOM release baseline, carries a Process Route Card (work_order_operations) and material
// requirements (work_order_materials), and generates/links the existing Job Card execution records
// underneath it — none of Job Cards' own time logs/consumables/rework lineage are rebuilt here.

export async function getWorkOrders({ status, mode, projectId } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('wo.status = ?'); args.push(status); }
  if (mode) { where.push('wo.mode = ?'); args.push(mode); }
  if (projectId) { where.push('wo.project_id = ?'); args.push(Number(projectId)); }
  return queryAll(
    `SELECT wo.*, p.project_no, p.customer_name, so.so_no,
            (SELECT COALESCE(SUM(qty_done), 0) FROM job_cards WHERE work_order_id = wo.id) AS qty_done,
            (SELECT COUNT(*) FROM job_cards WHERE work_order_id = wo.id) AS job_card_count,
            (SELECT COUNT(*) FROM job_cards WHERE work_order_id = wo.id AND status = 'done') AS job_cards_done
       FROM work_orders wo
       LEFT JOIN projects p ON p.id = wo.project_id
       LEFT JOIN sale_orders so ON so.id = wo.sale_order_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (wo.status IN ('draft','released','in_progress')) DESC, wo.planned_start, wo.id DESC`,
    args
  );
}

// STERP "Work Order Process Tracking" (item 27) lives in the `progress` block here — job-card
// completion, material consumption (bom-linked lines read live off material_issues, never a
// duplicate ledger), operation status, and a delay/rework flag, all derived, no new tracking table.
export async function getWorkOrderDetail(id) {
  const wo = await queryOne(
    `SELECT wo.*, p.project_no, p.customer_name, so.so_no
       FROM work_orders wo
       LEFT JOIN projects p ON p.id = wo.project_id
       LEFT JOIN sale_orders so ON so.id = wo.sale_order_id
      WHERE wo.id = ?`, [id]
  );
  if (!wo) return null;

  const [operations, materialsRaw, changeNotes, jobCards] = await Promise.all([
    queryAll(
      `SELECT wop.*, o.name AS operation_name, w.name AS workstation_name, m.milestone_label,
              (SELECT COUNT(*) FROM job_cards WHERE work_order_operation_id = wop.id) AS job_card_count,
              (SELECT COUNT(*) FROM job_cards WHERE work_order_operation_id = wop.id AND status = 'done') AS job_cards_done
         FROM work_order_operations wop
         LEFT JOIN operations o ON o.id = wop.operation_id
         LEFT JOIN workstations w ON w.id = wop.workstation_id
         LEFT JOIN milestones m ON m.id = wop.milestone_id
        WHERE wop.work_order_id = ? ORDER BY wop.seq, wop.id`, [id]),
    queryAll(
      `SELECT wom.*, i.item_name, i.item_code, bi.material_description AS bom_description,
              bi.moc AS bom_moc, bi.size_spec AS bom_size_spec,
              (SELECT SUM(qty) FROM material_issues WHERE bom_item_id = wom.bom_item_id) AS bom_qty_issued
         FROM work_order_materials wom
         LEFT JOIN items i ON i.id = wom.item_id
         LEFT JOIN bom_items bi ON bi.id = wom.bom_item_id
        WHERE wom.work_order_id = ? ORDER BY wom.id`, [id]),
    queryAll('SELECT * FROM work_order_change_notes WHERE work_order_id = ? ORDER BY created_at DESC', [id]),
    queryAll(
      `SELECT jc.*, o.name AS operation_name, w.name AS workstation_name
         FROM job_cards jc
         LEFT JOIN operations o ON o.id = jc.operation_id
         LEFT JOIN workstations w ON w.id = jc.workstation_id
        WHERE jc.work_order_id = ? ORDER BY jc.status, jc.id`, [id]),
  ]);

  const materials = materialsRaw.map(m => ({
    ...m,
    qty_issued: m.bom_item_id ? (m.bom_qty_issued || 0) : m.qty_issued,
  }));

  const qtyDone = jobCards.reduce((s, c) => s + (c.qty_done || 0), 0);
  const qtyRejected = jobCards.reduce((s, c) => s + (c.qty_rejected || 0), 0);
  const reworkCount = jobCards.filter(c => c.rework_of_job_card_id).length;
  const delayed = !!(wo.planned_end && !['completed', 'cancelled'].includes(wo.status)
    && new Date(wo.planned_end) < new Date() && qtyDone < wo.qty_planned);

  return {
    ...wo,
    operations,
    materials,
    changeNotes,
    jobCards,
    progress: {
      qtyPlanned: wo.qty_planned,
      qtyDone,
      qtyRejected,
      pct: wo.qty_planned ? Math.round((qtyDone / wo.qty_planned) * 100) : 0,
      jobCardsTotal: jobCards.length,
      jobCardsDone: jobCards.filter(c => c.status === 'done').length,
      reworkCount,
      delayed,
    },
  };
}

// STERP "Work Order Costing" (item 29) — actual vs. planned. Reuses getProjectCosting (extended
// with an optional workOrderId scope above) for the actual side when the Work Order is tied to a
// project, rather than a second conflicting cost rollup; against_stock Work Orders have no project
// to reuse it against, so their actual cost is computed directly off the same tables locally.
// Planned labor uses each route step's workstation machine_hour_rate where one is set — this app
// has no other standard-time-cost master. Subcontract/overhead: no cost field exists anywhere for
// outside-work vendor pricing or overhead allocation, so this returns the outside job-card list
// instead of a fabricated number.
export async function getWorkOrderCosting(id) {
  const wo = await queryOne('SELECT id, project_id, qty_planned FROM work_orders WHERE id = ?', [id]);
  if (!wo) return null;

  const [materials, operations, outsideCards, projectActual, stockLabor] = await Promise.all([
    queryAll('SELECT qty_required, unit_cost, qty_issued, bom_item_id FROM work_order_materials WHERE work_order_id = ?', [id]),
    queryAll(
      `SELECT wop.planned_minutes, w.machine_hour_rate FROM work_order_operations wop
         LEFT JOIN workstations w ON w.id = wop.workstation_id WHERE wop.work_order_id = ?`, [id]),
    queryAll(
      `SELECT id, section, outside_vendor, status FROM job_cards
        WHERE work_order_id = ? AND is_outside = 1`, [id]),
    wo.project_id ? getProjectCosting(wo.project_id, id) : Promise.resolve(null),
    wo.project_id ? Promise.resolve(null) : queryOne(
      `SELECT COALESCE(SUM(t.minutes / 60.0 * e.cost_rate_per_hour), 0) AS v FROM job_card_time_logs t
         JOIN job_cards jc ON jc.id = t.job_card_id
         JOIN employees e ON e.id = t.employee_id
        WHERE jc.work_order_id = ?`, [id]),
  ]);

  const plannedMaterialCost = materials.reduce((s, m) => s + (m.qty_required || 0) * (m.unit_cost || 0), 0);
  const plannedLaborCost = operations.reduce(
    (s, o) => s + (o.machine_hour_rate ? (o.planned_minutes || 0) / 60 * o.machine_hour_rate : 0), 0);

  const actualMaterialCost = wo.project_id
    ? projectActual.materialCost
    : materials.reduce((s, m) => s + (m.qty_issued || 0) * (m.unit_cost || 0), 0);
  const actualLaborCost = wo.project_id ? projectActual.laborCost : stockLabor.v;

  return {
    plannedMaterialCost, plannedLaborCost, plannedTotal: plannedMaterialCost + plannedLaborCost,
    actualMaterialCost, actualLaborCost, actualTotal: actualMaterialCost + actualLaborCost,
    materialScope: wo.project_id ? 'project (issued POs)' : 'work order (logged issues)',
    outsideJobCards: outsideCards,
  };
}

// STERP "Production Forecasting" (item 20) — upcoming material/production load off real planning
// data (open Work Orders' planned dates — themselves set from project milestones/order dates at WO
// creation, nothing new to derive there — their route cards' planned time per workstation, and
// their still-outstanding material lines), not a synthetic prediction model. horizonDays caps how
// far out to look.
export async function getProductionForecast(horizonDays = 30) {
  const workOrders = await queryAll(
    `SELECT wo.id, wo.wo_no, wo.mode, wo.qty_planned, wo.planned_start, wo.planned_end,
            p.project_no, p.customer_name
       FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id
      WHERE wo.status IN ('released','in_progress')
        AND (wo.planned_end IS NULL OR date(wo.planned_end) <= date('now', ?))
      ORDER BY wo.planned_start`,
    [`+${Number(horizonDays)} days`]
  );
  if (!workOrders.length) return { workOrders: [], workstationLoad: [], materialDemand: [], horizonDays };

  const ids = workOrders.map(w => w.id);
  const placeholders = ids.map(() => '?').join(',');
  const [workstationLoad, materialDemand] = await Promise.all([
    queryAll(
      `SELECT w.id AS workstation_id, w.name AS workstation_name, SUM(wop.planned_minutes) AS planned_minutes
         FROM work_order_operations wop JOIN workstations w ON w.id = wop.workstation_id
        WHERE wop.work_order_id IN (${placeholders}) AND wop.status != 'done'
        GROUP BY w.id ORDER BY planned_minutes DESC`, ids),
    queryAll(
      `SELECT COALESCE(i.item_name, bi.material_description, wom.description, 'Material #' || wom.id) AS material,
              SUM(wom.qty_required - COALESCE(
                CASE WHEN wom.bom_item_id IS NOT NULL
                  THEN (SELECT SUM(qty) FROM material_issues WHERE bom_item_id = wom.bom_item_id)
                  ELSE wom.qty_issued END, 0)) AS qty_outstanding
         FROM work_order_materials wom
         LEFT JOIN items i ON i.id = wom.item_id
         LEFT JOIN bom_items bi ON bi.id = wom.bom_item_id
        WHERE wom.work_order_id IN (${placeholders})
        GROUP BY material HAVING qty_outstanding > 0 ORDER BY qty_outstanding DESC`, ids),
  ]);

  // Flat capacity assumption — one 8-hour shift/day per workstation over the horizon. No shift-
  // calendar master exists in this app yet.
  // ponytail: real capacity calendar is the upgrade path once this shop runs multiple shifts.
  const capacityMinutes = Number(horizonDays) * 8 * 60;
  return {
    workOrders,
    workstationLoad: workstationLoad.map(w => ({
      ...w,
      capacityMinutes,
      overloaded: w.planned_minutes > capacityMinutes,
    })),
    materialDemand,
    horizonDays: Number(horizonDays),
  };
}

// ---------------------------------------------------------------------------------------------
// Report Engine — Production management reports (2026-08-22). All six roll up data Work Orders/
// Job Cards/Cutting already capture — no new schema, no new capture UI. Company-scoped via the
// linked project except where noted; an against_stock Work Order/Job Card has no project (§5l/§5g)
// and is shop-wide by nature, not one legal entity's, so it's included regardless of the company
// filter rather than silently dropped from every report.
// ---------------------------------------------------------------------------------------------

// §1 Work Order Register / Production Order Status — "what's in production and is it on time,"
// the same progress signals getWorkOrderDetail()/getWorkOrders() already compute (qty done/
// rejected, job-card counts, delayed flag), rolled across every Work Order in a period instead of
// one at a time.
export async function getWorkOrderRegisterLines(company, { from, to } = {}) {
  const conditions = ['(p.company = ? OR wo.project_id IS NULL)'];
  const args = [company];
  if (from) { conditions.push('date(wo.planned_start) >= ?'); args.push(from); }
  if (to) { conditions.push('date(wo.planned_start) <= ?'); args.push(to); }
  const rows = await queryAll(
    `SELECT wo.id, wo.wo_no, wo.mode, wo.product_description, wo.qty_planned, wo.planned_start,
            wo.planned_end, wo.status, p.project_no, p.customer_name, so.so_no,
            COALESCE((SELECT SUM(qty_done) FROM job_cards WHERE work_order_id = wo.id), 0) AS qty_done,
            COALESCE((SELECT SUM(qty_rejected) FROM job_cards WHERE work_order_id = wo.id), 0) AS qty_rejected,
            (SELECT COUNT(*) FROM job_cards WHERE work_order_id = wo.id) AS job_card_count,
            (SELECT COUNT(*) FROM job_cards WHERE work_order_id = wo.id AND status = 'done') AS job_cards_done
       FROM work_orders wo
       LEFT JOIN projects p ON p.id = wo.project_id
       LEFT JOIN sale_orders so ON so.id = wo.sale_order_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY wo.planned_start, wo.id`,
    args
  );
  const today = new Date();
  // Same delayed-flag definition as getWorkOrderDetail()'s progress block (§5l) — kept identical
  // on purpose so a Work Order's status here never disagrees with its own detail page.
  return rows.map(r => ({
    ...r,
    pct: r.qty_planned ? Math.round((r.qty_done / r.qty_planned) * 100) : 0,
    delayed: !!(r.planned_end && !['completed', 'cancelled'].includes(r.status)
      && new Date(r.planned_end) < today && r.qty_done < r.qty_planned),
  }));
}

// §2 Production Cost Variance — planned vs actual material+labour per Work Order over a period.
// Reuses getWorkOrderCosting() (already the tested planned/actual split, §5l) rather than a second
// cost rollup; this just loops it across the period's Work Orders and adds the variance the
// per-record costing view never needed (it's looking at one Work Order, not comparing many).
// Restricted to in_progress/completed — a draft/released Work Order has no actual cost yet, every
// line would be a meaningless 100% variance.
export async function getProductionCostVarianceLines(company, { from, to } = {}) {
  const conditions = ["(p.company = ? OR wo.project_id IS NULL)", "wo.status IN ('in_progress', 'completed')"];
  const args = [company];
  if (from) { conditions.push('date(wo.planned_start) >= ?'); args.push(from); }
  if (to) { conditions.push('date(wo.planned_start) <= ?'); args.push(to); }
  const workOrders = await queryAll(
    `SELECT wo.id, wo.wo_no, wo.product_description, wo.status, p.project_no, p.customer_name
       FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY wo.planned_start, wo.id`,
    args
  );
  const lines = [];
  for (const wo of workOrders) {
    const costing = await getWorkOrderCosting(wo.id);
    if (!costing) continue;
    const totalVariance = costing.actualTotal - costing.plannedTotal;
    lines.push({
      ...wo,
      ...costing,
      materialVariance: costing.actualMaterialCost - costing.plannedMaterialCost,
      laborVariance: costing.actualLaborCost - costing.plannedLaborCost,
      totalVariance,
      variancePct: costing.plannedTotal ? Math.round((totalVariance / costing.plannedTotal) * 100) : 0,
    });
  }
  return lines;
}

// §3 Rework / Rejection Report — Job Card qty_rejected + rework lineage, and QC test failures,
// rolled up by period. A real quality-cost signal nothing currently surfaces as a report
// (REPORT-ENGINE-PLAN.md §8). Two independent sections, not one merged table — a Job Card
// rejection and a QC test failure are different events with different shapes (a rejection is a
// quantity against a route step, a QC failure is a pass/fail test result), same reasoning GSTR-1's
// B2B/HSN split already established for this engine.
export async function getReworkRejectionData(company, { from, to } = {}) {
  const jcConditions = ['jc.qty_rejected > 0', '(p.company = ? OR jc.project_id IS NULL)'];
  const jcArgs = [company];
  if (from) { jcConditions.push('date(jc.updated_at) >= ?'); jcArgs.push(from); }
  if (to) { jcConditions.push('date(jc.updated_at) <= ?'); jcArgs.push(to); }
  const jobCardRejections = await queryAll(
    `SELECT jc.id, jc.updated_at, jc.section, jc.qty_rejected, jc.qty_done, jc.rework_of_job_card_id,
            o.name AS operation_name, p.project_no, p.customer_name, wo.wo_no
       FROM job_cards jc
       LEFT JOIN projects p ON p.id = jc.project_id
       LEFT JOIN operations o ON o.id = jc.operation_id
       LEFT JOIN work_orders wo ON wo.id = jc.work_order_id
      WHERE ${jcConditions.join(' AND ')}
      ORDER BY jc.updated_at DESC`,
    jcArgs
  );

  const qcConditions = ["qr.result = 'fail'", 'p.company = ?'];
  const qcArgs = [company];
  if (from) { qcConditions.push('date(qr.tested_on) >= ?'); qcArgs.push(from); }
  if (to) { qcConditions.push('date(qr.tested_on) <= ?'); qcArgs.push(to); }
  const qcFailures = await queryAll(
    `SELECT qr.id, qr.tested_on, qr.test_type, qr.result, qr.notes, qr.inspector,
            p.project_no, p.customer_name
       FROM qc_records qr JOIN projects p ON p.id = qr.project_id
      WHERE ${qcConditions.join(' AND ')}
      ORDER BY qr.tested_on DESC`,
    qcArgs
  );

  return {
    jobCardRejections,
    qcFailures,
    totalQtyRejected: jobCardRejections.reduce((s, r) => s + (r.qty_rejected || 0), 0),
    totalQcFailures: qcFailures.length,
    reworkCardsCreated: jobCardRejections.filter(r => r.rework_of_job_card_id).length,
  };
}

// §4 Material Utilization / Remnant & Scrap Report — reconstructs used/remnant/scrap per cut event
// from stock_pieces (lib/stock-pieces.js's cutPiece()); no separate cut_operations header row
// exists (§5k), so this derives per-event totals from parent/child rows instead of a stored
// summary. "Used" children are the ones born already status='consumed' in the SAME cutPiece()
// transaction as their parent (their cut_at equals the source's own cut_at, since both are set by
// the same transaction's CURRENT_TIMESTAMP); a remnant child only gets its own cut_at set LATER, if
// and when it's independently re-cut in a future, separate event — so it's correctly counted as
// recovered remnant here, not folded into this event's "used" weight, even after it's eventually
// consumed elsewhere. Not company-scoped: cut material is shared shop stock (a remnant purchased
// for one company's job can be reused on the other's), same "no company split" precedent as Stock
// Valuation (§10 Phase 1).
//
// Real bug caught live: a "used" child is ALSO born status='consumed' with cut_at set (it's
// created already-consumed, same INSERT that spends it) — so status='consumed' AND cut_at IS NOT
// NULL alone matches every used child too, not just real cut events, and each one showed up as its
// own phantom zero-output "cut." The actual test for "this row was itself cut" is "something else
// points at it as a parent" — `EXISTS` below.
export async function getMaterialUtilizationLines({ from, to } = {}) {
  const conditions = [
    "sp.status = 'consumed'", 'sp.cut_at IS NOT NULL',
    'EXISTS (SELECT 1 FROM stock_pieces c WHERE c.parent_id = sp.id)',
  ];
  const args = [];
  if (from) { conditions.push('date(sp.cut_at) >= ?'); args.push(from); }
  if (to) { conditions.push('date(sp.cut_at) <= ?'); args.push(to); }
  const rows = await queryAll(
    `SELECT sp.id, sp.code, sp.kind, sp.weight_kg AS source_weight, sp.cut_at, sp.cut_by,
            ii.description, ii.item_code,
            (SELECT COALESCE(SUM(weight_kg), 0) FROM stock_pieces WHERE parent_id = sp.id AND cut_at = sp.cut_at) AS used_weight,
            (SELECT COALESCE(SUM(weight_kg), 0) FROM stock_pieces WHERE parent_id = sp.id AND status = 'scrap') AS scrap_weight,
            (SELECT COALESCE(SUM(weight_kg), 0) FROM stock_pieces WHERE parent_id = sp.id AND status != 'scrap' AND (cut_at IS NULL OR cut_at != sp.cut_at)) AS remnant_weight
       FROM stock_pieces sp
       LEFT JOIN inventory_items ii ON ii.id = sp.inventory_item_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY sp.cut_at DESC`,
    args
  );
  return rows.map(r => ({
    ...r,
    yield_pct: r.source_weight ? Math.round(((r.used_weight + r.remnant_weight) / r.source_weight) * 100) : 0,
  }));
}

// §5 Labour Utilization / Productivity — job_card_time_logs summed by employee over a period, same
// join getJobCards() already does per card, rolled up per person instead. Cost uses today's
// employees.cost_rate_per_hour, same "not frozen historically" convention the Job Card cost total
// itself already uses (§5g). INNER JOINs projects (excludes against_stock cards, which have no
// project) — unlike material, labour cost genuinely belongs to one company's books.
export async function getLabourUtilizationLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('date(t.created_at) >= ?'); args.push(from); }
  if (to) { conditions.push('date(t.created_at) <= ?'); args.push(to); }
  return queryAll(
    `SELECT e.id AS employee_id, e.name AS employee_name, e.trade,
            SUM(t.minutes) AS total_minutes,
            SUM(t.minutes / 60.0 * COALESCE(e.cost_rate_per_hour, 0)) AS labor_cost,
            COUNT(DISTINCT t.job_card_id) AS job_cards_worked,
            COUNT(DISTINCT jc.work_order_id) AS work_orders_worked
       FROM job_card_time_logs t
       JOIN job_cards jc ON jc.id = t.job_card_id
       JOIN employees e ON e.id = t.employee_id
       JOIN projects p ON p.id = jc.project_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.id
      ORDER BY total_minutes DESC`,
    args
  );
}

// ---------------------------------------------------------------------------------------------
// STERP items 16-19 (§5o) — Multi-Level BOM, Where-Used, Common/Uncommon, Engineering Change Note.
// ---------------------------------------------------------------------------------------------

// One project's assembly tree + its bom_items, with roll-up quantity computed here (never stored).
// Roll-up = product of assembly.qty up the parent chain, times the item's own qty_text parsed as a
// leading number ("2 Nos" -> 2). qty_text is free text (spreadsheet-mirror column, §5a) — anything
// that doesn't start with a number is shown as-is with no computed roll-up.
// ponytail: leading-number parse is the ceiling; a real UOM-aware parser is the upgrade path if
// qty_text ever needs to support more than "N <unit>".
export async function getBomStructure(projectId) {
  const [assemblies, items, drawingCounts, calcCounts] = await Promise.all([
    queryAll('SELECT * FROM bom_assemblies WHERE project_id = ? ORDER BY sort_order, id', [projectId]),
    queryAll('SELECT id, assembly_id, material_description, qty_text FROM bom_items WHERE project_id = ? AND assembly_id IS NOT NULL', [projectId]),
    // BOM workspace Phase 2 — node-level document link counts, so the tree can show "3 drawings ·
    // 1 calc" badges without a per-node fetch. Scoped via a project_id join (bom_assembly_drawings/
    // calc_sheets carry no project_id of their own) rather than one query per assembly.
    queryAll(`SELECT ad.assembly_id, COUNT(*) AS n FROM bom_assembly_drawings ad
                JOIN bom_assemblies a ON a.id = ad.assembly_id WHERE a.project_id = ? GROUP BY ad.assembly_id`, [projectId]),
    queryAll(`SELECT ac.assembly_id, COUNT(*) AS n FROM bom_assembly_calc_sheets ac
                JOIN bom_assemblies a ON a.id = ac.assembly_id WHERE a.project_id = ? GROUP BY ac.assembly_id`, [projectId]),
  ]);
  const byId = new Map(assemblies.map(a => [a.id, a]));
  const itemsByAssembly = new Map();
  for (const it of items) {
    if (!itemsByAssembly.has(it.assembly_id)) itemsByAssembly.set(it.assembly_id, []);
    itemsByAssembly.get(it.assembly_id).push({ ...it, rolled_qty: itemRollupQty(it.qty_text, it.assembly_id, byId) });
  }
  const drawingCountById = new Map(drawingCounts.map(r => [r.assembly_id, r.n]));
  const calcCountById = new Map(calcCounts.map(r => [r.assembly_id, r.n]));
  return assemblies.map(a => ({
    ...a, rollup_qty: rollupQty(a.id, byId), items: itemsByAssembly.get(a.id) || [],
    drawing_count: drawingCountById.get(a.id) || 0, calc_count: calcCountById.get(a.id) || 0,
  }));
}

// Hybrid part identity for Where-Used/Common-Uncommon — see lib/bom-structure.mjs's own comment
// on why item_id (set only when a row is picked from catalog search — PMB bulk import, the
// dominant way a BOM actually gets populated, leaves it NULL) comes first, string match second.
async function allBomRowsWithIdentity() {
  const rows = await queryAll(`
    SELECT b.id, b.project_id, b.item_id, b.material_description, b.moc, b.size_spec, b.qty_text,
           b.assembly_id, b.source, b.sale_order_no, p.project_no, p.customer_name, p.is_system AS project_is_system,
           it.item_code AS catalog_item_code
      FROM bom_items b
      JOIN projects p ON p.id = b.project_id
      LEFT JOIN items it ON it.id = b.item_id`);
  return rows.map(r => ({ ...r, identity_key: partIdentityKey(r) })).filter(r => r.identity_key);
}

// Where-Used List (STERP item 17) — every project/assembly a part appears in. `query` matches
// against material_description (case-insensitive substring); returns rows grouped by identity so
// the caller can show "same part, N places" directly.
export async function getWhereUsed(query) {
  const rows = await allBomRowsWithIdentity();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const matchIdentities = new Set(
    rows.filter(r => r.material_description.toLowerCase().includes(needle)).map(r => r.identity_key));
  return rows.filter(r => matchIdentities.has(r.identity_key));
}

// Common/Uncommon List (STERP item 18) — group every BOM row by part identity, count distinct
// projects. Common = used in >= 2 projects; Uncommon = a single project. Threshold is a plain
// constant, easy to change if the real usage pattern turns out different.
const COMMON_THRESHOLD = 2;
export async function getPartUsage() {
  const rows = await allBomRowsWithIdentity();
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.identity_key)) groups.set(r.identity_key, { identity_key: r.identity_key, material_description: r.material_description, catalog_item_code: r.catalog_item_code, projects: new Map(), count: 0 });
    const g = groups.get(r.identity_key);
    g.count++;
    // Same sentinel-project labeling as getWhereUsed/ProcurementWorkspace's projectLabel().
    // ponytail: every stock/sas row shares the one sentinel project_id, so distinct SOs/stock
    // replenishments collapse into a single "project" here — a real edge case, only affects
    // Common/Uncommon classification for stock/sas-sourced lines. Upgrade path: key by
    // sale_order_no for source='sas' instead of project_id, if that ever matters in practice.
    const label = !r.project_is_system ? r.project_no : r.source === 'sas' ? `SO #${r.sale_order_no || '—'}` : r.source === 'stock' ? 'Stock' : r.project_no;
    g.projects.set(r.project_id, label);
  }
  return [...groups.values()].map(g => ({
    identity_key: g.identity_key,
    material_description: g.material_description,
    catalog_item_code: g.catalog_item_code,
    project_count: g.projects.size,
    project_nos: [...g.projects.values()],
    usage_count: g.count,
    classification: g.projects.size >= COMMON_THRESHOLD ? 'common' : 'uncommon',
  })).sort((a, b) => b.project_count - a.project_count);
}

// Engineering Change Note (STERP item 19) — the §5a-deferred "release/approval workflow for BOM
// revisions." List + one record's downstream impact (read-only: which POs/packing/tasks/drawing
// reference the changed item), computed live off existing FKs, no separate impact table.
export async function getEngineeringChangeNotes(projectId = null, assemblyId = null) {
  let where = '';
  let args = [];
  if (assemblyId) {
    // BOM workspace Phase 2 — a node's History tab shows ECNs for every item under it, including
    // nested descendants, not just items directly on that one node. Resolved as a separate query
    // (not a nested WITH RECURSIVE inside the main SELECT's WHERE) — simpler and avoids relying on
    // subquery-CTE support.
    const descendants = await queryAll(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM bom_assemblies WHERE id = ?
         UNION ALL
         SELECT a.id FROM bom_assemblies a JOIN descendants d ON a.parent_id = d.id
       )
       SELECT id FROM descendants`, [assemblyId]);
    const ids = descendants.map(d => d.id);
    if (!ids.length) return [];
    where = `WHERE b.assembly_id IN (${ids.map(() => '?').join(',')})`;
    args = ids;
  } else if (projectId) {
    where = 'WHERE ecn.project_id = ?';
    args = [projectId];
  }
  return queryAll(`
    SELECT ecn.*, p.project_no, p.customer_name, b.material_description
      FROM bom_change_notes ecn
      JOIN projects p ON p.id = ecn.project_id
      LEFT JOIN bom_items b ON b.id = ecn.bom_item_id
      ${where}
     ORDER BY ecn.created_at DESC`, args);
}

export async function getChangeNoteImpact(bomItemId) {
  if (!bomItemId) return { purchaseOrders: [], packingLines: [], tasks: [], drawing: null };
  const [purchaseOrders, packingLines, tasks, item] = await Promise.all([
    queryAll(`SELECT DISTINCT po.id, po.po_no, po.status FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE pi.bom_item_id = ?`, [bomItemId]),
    queryAll(`SELECT pi.id, pi.box_no, pl.status AS packing_list_status FROM packing_items pi JOIN packing_lists pl ON pl.id = pi.packing_list_id WHERE pi.bom_item_id = ?`, [bomItemId]),
    queryAll(`SELECT id, title, status FROM tasks WHERE bom_item_id = ?`, [bomItemId]),
    queryOne(`SELECT b.drawing_id, dw.name AS drawing_name, dw.revision AS drawing_revision FROM bom_items b LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id WHERE b.id = ?`, [bomItemId]),
  ]);
  return { purchaseOrders, packingLines, tasks, drawing: item?.drawing_id ? item : null };
}

// Report Engine — Design management reports (2026-08-22). Both off existing tables (calc_drawings,
// bom_change_notes), no new schema. Company-scoped via the linked project, same convention as
// every other catalog report.

// Drawing Register — every drawing's status/assignee/due date across projects, "what's still open
// and what's overdue," which nothing surfaces as a report today (calc_drawings only ever renders
// per-project on the Calc Sheets tab).
export async function getDrawingRegisterLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('date(cd.due_date) >= ?'); args.push(from); }
  if (to) { conditions.push('date(cd.due_date) <= ?'); args.push(to); }
  const rows = await queryAll(
    `SELECT cd.id, cd.name, cd.dg_no, cd.drawing_type, cd.status, cd.assigned_to, cd.due_date,
            p.project_no, p.customer_name
       FROM calc_drawings cd JOIN projects p ON p.id = cd.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY cd.due_date IS NULL, cd.due_date, cd.id`,
    args
  );
  const today = new Date();
  const OPEN_STATUSES = ['not_started', 'in_progress', 'under_review'];
  return rows.map(r => ({
    ...r,
    overdue: !!(r.due_date && OPEN_STATUSES.includes(r.status) && new Date(r.due_date) < today),
  }));
}

// ECN Register — every Engineering Change Note across projects/period, a real audit trail of what
// changed on a released BOM and why (bom_change_notes, §5o's ECN — the only path to move a
// released Work Order's baseline material data).
export async function getEcnRegisterLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('date(ecn.created_at) >= ?'); args.push(from); }
  if (to) { conditions.push('date(ecn.created_at) <= ?'); args.push(to); }
  return queryAll(
    `SELECT ecn.id, ecn.created_at, ecn.field_changed, ecn.old_value, ecn.new_value, ecn.reason,
            ecn.status, ecn.requested_by, ecn.approved_by, ecn.effective_revision,
            p.project_no, p.customer_name, b.material_description
       FROM bom_change_notes ecn
       JOIN projects p ON p.id = ecn.project_id
       LEFT JOIN bom_items b ON b.id = ecn.bom_item_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ecn.created_at DESC`,
    args
  );
}

// STERP item 13 (§5o) — Purchase Returns, the Procurement-side mirror of getSalesReturns() above.
export async function getPurchaseReturns() {
  return queryAll(`
    SELECT pr.*, po.po_no, s.name AS supplier_name, i.description AS inventory_description
      FROM purchase_returns pr
      JOIN purchase_orders po ON po.id = pr.po_id
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN inventory_items i ON i.id = pr.inventory_item_id
     ORDER BY pr.created_at DESC
  `);
}

// Flat assembly list for a project — just enough for the BOM edit dialog's "assign to assembly"
// picker (project page). getBomStructure (above) is the richer tree+rollup view for the
// Engineering workspace; this is the lean id/name/parent shape a <select> needs.
export async function getBomAssembliesFlat(projectId) {
  return queryAll('SELECT id, name, parent_id FROM bom_assemblies WHERE project_id = ? ORDER BY sort_order, id', [projectId]);
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 0 — one row per legal entity.
export async function getCompanySettings() {
  return queryAll('SELECT * FROM company_settings ORDER BY id');
}

// Company Entities (2026-08-22) — the two real numbers lib/company-entity.mjs's
// computeApplicability() needs, both already tracked elsewhere in Shanti Ops: active headcount for
// this company, and whether the company's own registered state actually levies Professional Tax.
// Deliberately not fetched from anywhere — company-specific applicability stays Shanti Ops' job,
// never statutory-rates-hub's (the architecture rule this feature is built around).
export async function getCompanyApplicabilityInputs(company, state) {
  const [{ n: activeEmployeeCount }, ptRow] = await Promise.all([
    queryOne('SELECT COUNT(*) AS n FROM employees WHERE company = ? AND active = 1', [company]),
    queryOne('SELECT 1 AS x FROM professional_tax_slabs WHERE state = ? AND active = 1 LIMIT 1', [state]),
  ]);
  return { activeEmployeeCount, hasActivePtSlabForState: !!ptRow };
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 1 — GST & TDS rate masters.
export async function getGstRates() {
  return queryAll('SELECT * FROM gst_rates ORDER BY hsn_code, effective_from DESC');
}
export async function getVendorTdsRates() {
  return queryAll('SELECT * FROM vendor_tds_rates ORDER BY section, effective_from DESC');
}

// Shared by the admin POST routes and the statutory-rates-hub sync (lib/rate-sync.js) — one
// insert path so a rate entered by hand and one pulled from the hub go through the same rules.
export async function insertGstRate({ hsn_code, description, rate_pct, effective_from, effective_to }) {
  if (!hsn_code || rate_pct == null || !effective_from) {
    throw new Error('hsn_code, rate_pct, effective_from are required');
  }
  const existing = await queryOne(
    'SELECT id FROM gst_rates WHERE hsn_code = ? AND effective_from = ? AND effective_to IS ? AND rate_pct = ?',
    [hsn_code, effective_from, effective_to ?? null, rate_pct]
  );
  if (existing) return existing.id;
  const { lastId } = await execute(
    'INSERT INTO gst_rates (hsn_code, description, rate_pct, effective_from, effective_to) VALUES (?, ?, ?, ?, ?)',
    [hsn_code, description ?? null, rate_pct, effective_from, effective_to ?? null]
  );
  return Number(lastId);
}

export async function insertVendorTdsRate({ section, description, rate_pct, threshold_amount, effective_from, effective_to }) {
  if (!section || rate_pct == null || !effective_from) {
    throw new Error('section, rate_pct, effective_from are required');
  }
  const existing = await queryOne(
    'SELECT id FROM vendor_tds_rates WHERE section = ? AND effective_from = ? AND effective_to IS ? AND rate_pct = ? AND threshold_amount IS ?',
    [section, effective_from, effective_to ?? null, rate_pct, threshold_amount ?? null]
  );
  if (existing) return existing.id;
  const { lastId } = await execute(
    'INSERT INTO vendor_tds_rates (section, description, rate_pct, threshold_amount, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?)',
    [section, description ?? null, rate_pct, threshold_amount ?? null, effective_from, effective_to ?? null]
  );
  return Number(lastId);
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2 — Sales Invoice + Credit Note.
export async function getSalesInvoices({ projectId } = {}) {
  const conditions = [];
  const args = [];
  if (projectId) { conditions.push('si.project_id = ?'); args.push(projectId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return queryAll(
    `SELECT si.*, c.name AS customer_name FROM sales_invoices si JOIN customers c ON c.id = si.customer_id
      ${where}
      ORDER BY si.created_at DESC`,
    args
  );
}
export async function getSalesInvoiceDetail(id) {
  const [invoice, items] = await Promise.all([
    queryOne(
      `SELECT si.*, c.name AS customer_name, c.state_code AS customer_state_code,
              c.gst_no AS customer_gst_no, c.address AS customer_address
         FROM sales_invoices si JOIN customers c ON c.id = si.customer_id WHERE si.id = ?`, [id]),
    queryAll('SELECT * FROM sales_invoice_items WHERE sales_invoice_id = ? ORDER BY sort_order, id', [id]),
  ]);
  return invoice ? { ...invoice, items } : null;
}
export async function getSalesCreditNotes() {
  return queryAll(
    `SELECT scn.*, si.invoice_no FROM sales_credit_notes scn JOIN sales_invoices si ON si.id = scn.sales_invoice_id
      ORDER BY scn.created_at DESC`
  );
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 3 — Vendor Bill + Debit Note.
export async function getVendorBills() {
  return queryAll(
    `SELECT vb.*, po.po_no, s.name AS supplier_name FROM vendor_bills vb
       JOIN purchase_orders po ON po.id = vb.po_id JOIN suppliers s ON s.id = po.supplier_id
      ORDER BY vb.created_at DESC`
  );
}
export async function getVendorBillDetail(id) {
  const [bill, items] = await Promise.all([
    queryOne(
      `SELECT vb.*, po.po_no, s.name AS supplier_name, s.state_code AS supplier_state_code,
              s.gst_no AS supplier_gst_no, s.address AS supplier_address
         FROM vendor_bills vb
         JOIN purchase_orders po ON po.id = vb.po_id JOIN suppliers s ON s.id = po.supplier_id WHERE vb.id = ?`, [id]),
    queryAll('SELECT * FROM vendor_bill_items WHERE vendor_bill_id = ? ORDER BY sort_order, id', [id]),
  ]);
  return bill ? { ...bill, items } : null;
}
export async function getPurchaseDebitNotes() {
  return queryAll(
    `SELECT pdn.*, vb.bill_no FROM purchase_debit_notes pdn JOIN vendor_bills vb ON vb.id = pdn.vendor_bill_id
      ORDER BY pdn.created_at DESC`
  );
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 — General Ledger.
export async function getChartOfAccounts(company) {
  return queryAll(
    'SELECT * FROM chart_of_accounts WHERE company = ? ORDER BY code',
    [company]
  );
}
export async function getJournalEntries(company, { from, to, status, sourceType } = {}) {
  const conditions = ['je.company = ?'];
  const args = [company];
  if (from) { conditions.push('je.entry_date >= ?'); args.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); args.push(to); }
  if (status) { conditions.push('je.status = ?'); args.push(status); }
  if (sourceType) { conditions.push('je.source_type = ?'); args.push(sourceType); }
  const entries = await queryAll(
    `SELECT je.* FROM journal_entries je WHERE ${conditions.join(' AND ')} ORDER BY je.entry_date DESC, je.id DESC`,
    args
  );
  if (!entries.length) return [];
  const lines = await queryAll(
    `SELECT jel.*, coa.code AS account_code, coa.name AS account_name, coa.account_type
       FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE jel.journal_entry_id IN (${entries.map(() => '?').join(',')})
      ORDER BY jel.journal_entry_id, jel.sort_order`,
    entries.map(e => e.id)
  );
  const linesByEntry = new Map();
  for (const l of lines) {
    if (!linesByEntry.has(l.journal_entry_id)) linesByEntry.set(l.journal_entry_id, []);
    linesByEntry.get(l.journal_entry_id).push(l);
  }
  return entries.map(e => ({ ...e, lines: linesByEntry.get(e.id) || [] }));
}
// Flat account_code/account_name/account_type/debit/credit rows for lib/ledger.mjs's
// trialBalance()/profitAndLoss()/balanceSheet() to roll up — those functions are pure, this is the
// one query that feeds them. `to` filters by entry_date <= to (cumulative as-of-date, what Balance
// Sheet needs); pass both `from` and `to` for a period slice (what P&L / Trial Balance need).
// Feeds lib/ledger.mjs's trialBalance()/profitAndLoss()/balanceSheet() — status = 'posted' always,
// no parameter to override it: a draft manual journal must never affect a financial statement.
export async function getLedgerLines(company, { from, to } = {}) {
  const conditions = ["je.company = ?", "je.status = 'posted'"];
  const args = [company];
  if (from) { conditions.push('je.entry_date >= ?'); args.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT coa.code AS account_code, coa.name AS account_name, coa.account_type, jel.debit, jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE ${conditions.join(' AND ')}`,
    args
  );
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance sub-step (current model — see
// lib/gst-return.mjs's own header comment). period is 'YYYY-MM'; feeds gstr1Summary() — one row
// per sales_invoice_item, joined to its invoice's document-level tax split and its customer's
// GSTIN, for gstr1Summary() to apportion and group. Issued/paid only — a draft invoice hasn't
// actually been supplied yet and shouldn't appear on a GST return.
export async function getGstr1Lines(company, period) {
  return queryAll(
    `SELECT sii.hsn_code, sii.uom, sii.qty, sii.amount, si.invoice_no,
            si.subtotal AS invoice_subtotal, si.cgst_amount AS invoice_cgst,
            si.sgst_amount AS invoice_sgst, si.igst_amount AS invoice_igst,
            c.gst_no AS customer_gstin, c.name AS customer_name
       FROM sales_invoice_items sii
       JOIN sales_invoices si ON si.id = sii.sales_invoice_id
       JOIN customers c ON c.id = si.customer_id
      WHERE si.company = ? AND si.status IN ('issued', 'paid') AND strftime('%Y-%m', si.invoice_date) = ?`,
    [company, period]
  );
}
// Vendor Bills for a period, with the supplier's GSTIN — what lib/gst-return.mjs's
// itcReconciliation() matches GSTR-2B lines against.
export async function getVendorBillsForPeriod(company, period) {
  return queryAll(
    `SELECT vb.id, vb.bill_no, vb.bill_date, s.gst_no AS supplier_gstin, s.name AS supplier_name, vb.total
       FROM vendor_bills vb
       JOIN purchase_orders po ON po.id = vb.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE vb.company = ? AND strftime('%Y-%m', vb.bill_date) = ?`,
    [company, period]
  );
}
export async function getGstr2bLines(company, period) {
  return queryAll(
    'SELECT * FROM gstr2b_lines WHERE company = ? AND period = ? ORDER BY invoice_date, id',
    [company, period]
  );
}
export async function getGstFilings(company) {
  return queryAll('SELECT * FROM gst_filings WHERE company = ? ORDER BY period DESC, return_type', [company]);
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 completion — Manual Journal Entry, AR/AP settlement,
// bank reconciliation.
export async function getJournalEntry(id) {
  const entry = await queryOne('SELECT * FROM journal_entries WHERE id = ?', [id]);
  if (!entry) return null;
  const lines = await queryAll(
    `SELECT jel.*, coa.code AS account_code, coa.name AS account_name, coa.account_type
       FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE jel.journal_entry_id = ? ORDER BY jel.sort_order`,
    [id]
  );
  return { ...entry, lines };
}

export async function getCustomerReceipts(salesInvoiceId) {
  return queryAll('SELECT * FROM customer_receipts WHERE sales_invoice_id = ? ORDER BY receipt_date, id', [salesInvoiceId]);
}
export async function getVendorPayments(vendorBillId) {
  return queryAll('SELECT * FROM vendor_payments WHERE vendor_bill_id = ? ORDER BY payment_date, id', [vendorBillId]);
}

// REPORT-ENGINE-PLAN.md §10 Phase 1 — Customer Ledger. Flat, normalized debit/credit rows across
// the three document types that move a customer's receivable (issued/paid invoices, receipts,
// issued credit notes), for lib/ledger.mjs's customerLedger() to roll into a running balance — same
// "query here, pure rollup there" split as getLedgerLines() feeds trialBalance(). No journal-entry
// route exists for this: journal_entry_lines carries no customer dimension, so a per-customer
// statement can only be built from the source documents directly, not derived from the GL.
export async function getCustomerLedgerLines(customerId, company) {
  // sort_rank (not part of the returned shape callers care about, harmlessly along for the ride):
  // same-day ties need explicit precedence — alphabetical ('Credit Note' < 'Invoice' < 'Receipt')
  // was ordering a credit note BEFORE the invoice it's issued against (caught while verifying Stock
  // Ledger's analogous Issue-before-Receipt bug). SQLite forbids an ORDER BY expression (like a
  // CASE) in a compound/UNION ALL query — it must be an actual output column, hence selecting it.
  return queryAll(
    `SELECT invoice_no AS ref, invoice_date AS date, total AS debit, 0 AS credit, 'Invoice' AS kind, 1 AS sort_rank
       FROM sales_invoices WHERE customer_id = ? AND company = ? AND status != 'draft'
     UNION ALL
     SELECT scn.credit_note_no, scn.credit_note_date, 0, scn.amount, 'Credit Note', 2
       FROM sales_credit_notes scn JOIN sales_invoices si ON si.id = scn.sales_invoice_id
      WHERE si.customer_id = ? AND si.company = ? AND scn.status = 'issued'
     UNION ALL
     SELECT cr.receipt_no, cr.receipt_date, 0, cr.amount, 'Receipt', 3
       FROM customer_receipts cr JOIN sales_invoices si ON si.id = cr.sales_invoice_id
      WHERE si.customer_id = ? AND si.company = ?
     ORDER BY date, sort_rank`,
    [customerId, company, customerId, company, customerId, company]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Inventory Aging. "Days since last movement" per item with stock on
// hand — initially flagged blocked (no obvious direct link from receipts/issues to inventory_items)
// but the join exists, just indirect: vendor_bill_items/material_issues -> bom_items.item_id ->
// inventory_items.item_id (the exact join lib/db.js's Vendor Bill approval already uses to update
// avg_cost, confirmed by reading that route). Items with stock but no movement history ever (never
// received/issued through a BOM item) get `lastMovement: null` and are treated as maximally aged —
// dead stock that predates this app's own tracking is still dead stock, not "recent" by default.
export async function getInventoryAgingLines() {
  return queryAll(
    `SELECT ii.id AS itemId, ii.item_code, ii.description, ii.on_hand, ii.avg_cost,
            MAX(COALESCE(recv.last_date, ''), COALESCE(iss.last_date, '')) AS lastMovement
       FROM inventory_items ii
       LEFT JOIN (
         SELECT b.item_id, MAX(vb.bill_date) AS last_date
           FROM vendor_bill_items vbi
           JOIN bom_items b ON b.id = vbi.bom_item_id
           JOIN vendor_bills vb ON vb.id = vbi.vendor_bill_id
          WHERE vbi.bom_item_id IS NOT NULL
          GROUP BY b.item_id
       ) recv ON recv.item_id = ii.item_id
       LEFT JOIN (
         SELECT b.item_id, MAX(date(mi.issued_at)) AS last_date
           FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
          GROUP BY b.item_id
       ) iss ON iss.item_id = ii.item_id
      WHERE ii.on_hand > 0`
  );
}

// REPORT-ENGINE-PLAN.md §10 — Stock Ledger. Per-item receipts (Vendor Bill lines) and issues
// (material_issues), same indirect-but-real join as getInventoryAgingLines — fed to
// lib/ledger.mjs's runningLedger() same as Customer/Vendor Ledger, just tracking quantity instead
// of money (the running-balance math is identical either way).
export async function getStockLedgerLines(inventoryItemId) {
  // sort_rank: Receipt before Issue on a same-day tie — alphabetical ('Issue' < 'Receipt') was
  // ordering an issue before the receipt that stocked it, producing a nonsense negative intermediate
  // balance. Selected as a real column, not a CASE in ORDER BY — SQLite forbids that in a compound
  // query (same fix as getCustomerLedgerLines/getVendorLedgerLines).
  return queryAll(
    `WITH target AS (SELECT item_id FROM inventory_items WHERE id = ?)
     SELECT vb.bill_no AS ref, vb.bill_date AS date, vbi.qty AS debit, 0 AS credit, 'Receipt' AS kind, 1 AS sort_rank
       FROM vendor_bill_items vbi
       JOIN bom_items b ON b.id = vbi.bom_item_id
       JOIN vendor_bills vb ON vb.id = vbi.vendor_bill_id
      WHERE vbi.bom_item_id IS NOT NULL AND b.item_id = (SELECT item_id FROM target)
     UNION ALL
     SELECT 'Issue #' || mi.id, date(mi.issued_at), 0, mi.qty, 'Issue', 2
       FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
      WHERE b.item_id = (SELECT item_id FROM target)
     ORDER BY date, sort_rank`,
    [inventoryItemId]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Material Consumption Report. material_issues.total_cost (populated at
// issue time via lib/inventory-costing.mjs's consumptionCost() — app/api/material-issues/route.js),
// joined to its project for context. Only issues that actually resolved to a costed inventory item
// are included (total_cost IS NOT NULL) — an issue that didn't cost has nothing to report here, same
// as it wasn't costed before this pass either.
export async function getMaterialConsumptionLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?', 'mi.total_cost IS NOT NULL'];
  const args = [company];
  if (from) { conditions.push('date(mi.issued_at) >= ?'); args.push(from); }
  if (to) { conditions.push('date(mi.issued_at) <= ?'); args.push(to); }
  return queryAll(
    `SELECT mi.id, mi.issued_at, b.material_description, p.project_no, p.customer_name,
            mi.qty, mi.unit_cost, mi.total_cost
       FROM material_issues mi
       JOIN bom_items b ON b.id = mi.bom_item_id
       JOIN projects p ON p.id = b.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY mi.issued_at`,
    args
  );
}

// REPORT-ENGINE-PLAN.md §10 Phase 1 — Stock Valuation. inventory_items.on_hand × avg_cost (the
// weighted-average running cost lib/inventory-costing.mjs maintains on every Vendor Bill receipt) —
// real data since that Phase 5 costing work landed, no company split (Stores is one shared
// warehouse, not per-legal-entity — inventory_items itself carries no company column).
export async function getStockValuation() {
  return queryAll(
    `SELECT id, item_code, description, on_hand, avg_cost, ROUND(on_hand * avg_cost, 2) AS value
       FROM inventory_items WHERE on_hand > 0 ORDER BY value DESC`
  );
}

// REPORT-ENGINE-PLAN.md §10 — Receivables Aging. Outstanding (issued/paid, not draft/cancelled)
// invoices minus what's been received against them — lib/ledger.mjs's agingBuckets() does the
// bucketing. `settled` = SUM(customer_receipts.amount), same source Customer Ledger's receipt rows
// come from.
export async function getArAgingLines(company) {
  return queryAll(
    `SELECT si.invoice_no AS ref, c.name AS party, si.invoice_date AS date, si.due_date AS dueDate,
            si.total AS amount,
            COALESCE((SELECT SUM(amount) FROM customer_receipts WHERE sales_invoice_id = si.id), 0) AS settled
       FROM sales_invoices si JOIN customers c ON c.id = si.customer_id
      WHERE si.company = ? AND si.status IN ('issued', 'paid')`,
    [company]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Payables Aging. Mirror of getArAgingLines against vendor_bills /
// vendor_payments.
export async function getApAgingLines(company) {
  return queryAll(
    `SELECT vb.bill_no AS ref, s.name AS party, vb.bill_date AS date, vb.due_date AS dueDate,
            vb.payable_amount AS amount,
            COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE vendor_bill_id = vb.id), 0) AS settled
       FROM vendor_bills vb
       JOIN purchase_orders po ON po.id = vb.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE vb.company = ? AND vb.status IN ('approved', 'paid')`,
    [company]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Vendor Ledger. Mirror of getCustomerLedgerLines: bills (credit —
// increases what's owed), payments and issued debit notes (debit — reduces it), fed to the same
// lib/ledger.mjs's runningLedger() Customer Ledger uses.
export async function getVendorLedgerLines(supplierId, company) {
  // sort_rank: same fix/reasoning as getCustomerLedgerLines — SQLite forbids a CASE expression in a
  // compound query's ORDER BY, so precedence has to be a real selected column.
  return queryAll(
    `SELECT vb.bill_no AS ref, vb.bill_date AS date, 0 AS debit, vb.payable_amount AS credit, 'Bill' AS kind, 1 AS sort_rank
       FROM vendor_bills vb JOIN purchase_orders po ON po.id = vb.po_id
      WHERE po.supplier_id = ? AND vb.company = ?
     UNION ALL
     SELECT pdn.debit_note_no, pdn.debit_note_date, pdn.amount, 0, 'Debit Note', 2
       FROM purchase_debit_notes pdn
       JOIN vendor_bills vb ON vb.id = pdn.vendor_bill_id
       JOIN purchase_orders po ON po.id = vb.po_id
      WHERE po.supplier_id = ? AND vb.company = ? AND pdn.status = 'issued'
     UNION ALL
     SELECT vp.payment_no, vp.payment_date, vp.amount, 0, 'Payment', 3
       FROM vendor_payments vp
       JOIN vendor_bills vb ON vb.id = vp.vendor_bill_id
       JOIN purchase_orders po ON po.id = vb.po_id
      WHERE po.supplier_id = ? AND vb.company = ?
     ORDER BY date, sort_rank`,
    [supplierId, company, supplierId, company, supplierId, company]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Cash/Bank Book. Chronological Bank & Cash (account 1001) GL lines —
// the same posted journal_entry_lines Trial Balance rolls up, filtered to one account instead of
// all of them, fed to runningLedger() same as Customer/Vendor Ledger. `kind` here is the posting's
// own description (there's no separate voucher-type column), `ref` is the journal entry id.
// Deliberately no date filter in SQL, same as getCustomerLedgerLines — runningLedger() needs rows
// *before* `from` to compute the opening balance; filtering them out here would zero it every time.
export async function getCashBookLines(company) {
  return queryAll(
    `SELECT je.id AS ref, je.entry_date AS date, COALESCE(je.description, je.source_type) AS kind, jel.debit, jel.credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.company = ? AND je.status = 'posted' AND coa.code = '1001'
      ORDER BY je.entry_date, je.id`,
    [company]
  );
}

// REPORT-ENGINE-PLAN.md §10 — Journal Register. Chronological journal_entries (one row per entry,
// not per line — distinct from the per-account GL view Trial Balance/Cash Book give), each with its
// total debit as the entry amount (always equals total credit — assertBalanced() is enforced at
// posting time, never reads back unbalanced).
export async function getJournalRegisterLines(company, { from, to } = {}) {
  const conditions = ["je.company = ?", "je.status = 'posted'"];
  const args = [company];
  if (from) { conditions.push('je.entry_date >= ?'); args.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT je.id, je.entry_date, je.source_type, je.description, SUM(jel.debit) AS amount
       FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY je.id ORDER BY je.entry_date, je.id`,
    args
  );
}

// REPORT-ENGINE-PLAN.md §10 — Purchase Register. Every approved/paid Vendor Bill in a period, the
// classic "list every purchase this period" GST/audit document.
export async function getPurchaseRegisterLines(company, { from, to } = {}) {
  const conditions = ["vb.company = ?", "vb.status IN ('approved', 'paid')"];
  const args = [company];
  if (from) { conditions.push('vb.bill_date >= ?'); args.push(from); }
  if (to) { conditions.push('vb.bill_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT vb.bill_no, vb.bill_date, s.name AS supplier_name, vb.subtotal, vb.tax_amount, vb.total, vb.payable_amount
       FROM vendor_bills vb
       JOIN purchase_orders po ON po.id = vb.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY vb.bill_date, vb.id`,
    args
  );
}

// TDS Deduction Register — every vendor bill with a TDS deduction, for quarterly 26Q filing prep
// (this app computes and deducts TDS per bill; it does not generate the TRACES-format return
// itself — that's still done externally, this is the register you'd hand to whoever files it).
// financial_year/quarter computed here, not stored, since bill_date is already the source of truth.
function fyQuarter(dateISO) {
  const m = Number(dateISO.split('-')[1]);
  if (m >= 4 && m <= 6) return 'Q1'; if (m >= 7 && m <= 9) return 'Q2';
  if (m >= 10 && m <= 12) return 'Q3'; return 'Q4';
}
export async function getTdsDeductionRegisterLines(company, { from, to } = {}) {
  const conditions = ['vb.company = ?', 'vb.tds_amount > 0'];
  const args = [company];
  if (from) { conditions.push('vb.bill_date >= ?'); args.push(from); }
  if (to) { conditions.push('vb.bill_date <= ?'); args.push(to); }
  const rows = await queryAll(
    `SELECT vb.bill_no, vb.bill_date, s.name AS supplier_name, s.pan AS supplier_pan,
            vb.tds_section, vb.tds_rate_pct, vb.total, vb.tds_amount
       FROM vendor_bills vb
       JOIN purchase_orders po ON po.id = vb.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY vb.bill_date, vb.id`,
    args
  );
  return rows.map(r => ({ ...r, financial_year: financialYear(r.bill_date), quarter: fyQuarter(r.bill_date) }));
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9 — Depreciation Schedule: one row per asset per period
// run, tying back to depreciation_run_lines (lib/fixed-assets.js's runDepreciation() writer). Plain
// join, no new calculation — the amount was already computed once by lib/depreciation.mjs's
// monthlyDepreciation() at run time and is never recomputed here.
export async function getDepreciationScheduleLines(company, { from, to } = {}) {
  const conditions = ['dr.company = ?'];
  const args = [company];
  if (from) { conditions.push('dr.run_date >= ?'); args.push(from); }
  if (to) { conditions.push('dr.run_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT dr.period_year, dr.period_month, dr.run_date, fa.asset_no, fa.name AS asset_name,
            fa.method, drl.amount
       FROM depreciation_run_lines drl
       JOIN depreciation_runs dr ON dr.id = drl.depreciation_run_id
       JOIN fixed_assets fa ON fa.id = drl.fixed_asset_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY dr.period_year, dr.period_month, fa.asset_no`,
    args
  );
}

// ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9 — Cash Flow Statement's Investing section. Fixed Asset
// purchase/disposal postings always touch Bank & Cash directly (lib/ledger.mjs's
// fixedAssetPurchaseLines/fixedAssetDisposalLines), but the Fixed Assets/Accumulated Depreciation
// account balance changes those events also cause aren't the same number as the cash effect (a
// disposal removes cost at book value, not at what was actually received) — so
// lib/cash-flow.mjs's indirectCashFlow() reads the real Bank & Cash lines for these two source
// types directly instead of going through its generic account-balance-change loop.
export async function getFixedAssetCashLines(company, { from, to } = {}) {
  const conditions = ["je.company = ?", "je.status = 'posted'", "coa.code = '1001'", "je.source_type IN ('fixed_asset','fixed_asset_disposal')"];
  const args = [company];
  if (from) { conditions.push('je.entry_date >= ?'); args.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT jel.debit, jel.credit, je.entry_date, je.description, je.source_type, je.source_id
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY je.entry_date`,
    args
  );
}

// Open PO Aging — issued Purchase Orders with at least one line still `TRANSIT` (issued, not yet
// Received/CLOSED/Cancelled), aged by days since `issued_at`. Neither Purchase Register (bill-
// based — only exists once a Vendor Bill is raised) nor Procurement Spend (financial roll-up of
// bills) answers "what's stuck in the pipeline right now" — this does, off data already captured
// (po.issued_at, bom_items.purchase_status). Not the blocked Supplier Performance metric
// (REPORT-ENGINE-PLAN.md §9 — that needs a *promised* date vs. actual, which isn't consistently
// populated) — this only needs *issued* date, which always is.
export async function getOpenPoAgingLines(company, { asOf } = {}) {
  const resolvedAsOf = asOf || todayISO();
  const rows = await queryAll(
    `SELECT po.id, po.po_no, po.issued_at, s.name AS supplier_name,
            COUNT(pi.id) AS line_count,
            SUM(pi.amount) AS po_value,
            SUM(CASE WHEN bi.purchase_status = 'Transit' THEN 1 ELSE 0 END) AS open_line_count,
            SUM(CASE WHEN bi.purchase_status = 'Transit' THEN pi.amount ELSE 0 END) AS open_value
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN po_items pi ON pi.po_id = po.id
       LEFT JOIN bom_items bi ON bi.id = pi.bom_item_id
      WHERE po.status = 'issued'
        AND EXISTS (
          SELECT 1 FROM po_items pi2 LEFT JOIN projects p2 ON p2.id = pi2.project_id
           WHERE pi2.po_id = po.id AND (p2.company = ? OR p2.is_system = 1)
        )
      GROUP BY po.id
     HAVING open_line_count > 0
      ORDER BY po.issued_at`,
    [company]
  );
  const asOfMs = new Date(resolvedAsOf).getTime();
  return rows.map((r) => ({
    ...r,
    daysOpen: r.issued_at ? Math.floor((asOfMs - new Date(r.issued_at).getTime()) / 86400000) : null,
  }));
}

// REPORT-ENGINE-PLAN.md §10 — Sales Register. Mirror of getPurchaseRegisterLines against
// sales_invoices — every issued/paid Sales Invoice in a period.
export async function getSalesRegisterLines(company, { from, to } = {}) {
  const conditions = ["si.company = ?", "si.status IN ('issued', 'paid')"];
  const args = [company];
  if (from) { conditions.push('si.invoice_date >= ?'); args.push(from); }
  if (to) { conditions.push('si.invoice_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT si.invoice_no, si.invoice_date, c.name AS customer_name, si.subtotal, si.tax_amount, si.total
       FROM sales_invoices si JOIN customers c ON c.id = si.customer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY si.invoice_date, si.id`,
    args
  );
}

// Dispatch accounting integration, 2026-08-23 — Dispatch's first-ever Report Engine entry.
// dispatched_at is NULL for every packing list dispatched before this column existed; the
// COALESCE fallback to updated_at is a real approximation for those historical rows (not
// necessarily the actual dispatch date), not a data claim — worth a note on the report itself.
export async function getDispatchRegisterLines(company, { from, to } = {}) {
  const conditions = ["p.company = ?", "pl.status = 'dispatched'"];
  const args = [company];
  if (from) { conditions.push('COALESCE(pl.dispatched_at, pl.updated_at) >= ?'); args.push(from); }
  if (to) { conditions.push('COALESCE(pl.dispatched_at, pl.updated_at) <= ?'); args.push(to); }
  return queryAll(
    `SELECT pl.packing_no, COALESCE(pl.dispatched_at, pl.updated_at) AS dispatched_at,
            pl.customer_name, pl.invoice_no, si.invoice_no AS linked_invoice_no,
            pl.freight_amount, pl.freight_paid_by, pl.eway_bill_no
       FROM packing_lists pl
       JOIN projects p ON p.id = pl.project_id
       LEFT JOIN sales_invoices si ON si.id = pl.sales_invoice_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY dispatched_at, pl.id`,
    args
  );
}

// E-Way Bill Register (plan §4) — every dispatched shipment that actually carries an e-way bill
// number, company-scoped through the same projects join getDispatchRegisterLines uses.
export async function getEwayBillLines(company, { from, to } = {}) {
  const conditions = ["p.company = ?", "pl.eway_bill_no IS NOT NULL"];
  const args = [company];
  if (from) { conditions.push('pl.eway_bill_date >= ?'); args.push(from); }
  if (to) { conditions.push('pl.eway_bill_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT pl.eway_bill_no, pl.eway_bill_date, pl.packing_no, pl.vehicle_no, pl.dispatch_through, pl.invoice_no
       FROM packing_lists pl JOIN projects p ON p.id = pl.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pl.eway_bill_date, pl.id`,
    args
  );
}

// Freight Cost Summary (plan §4) — freight spend grouped by who paid it and by month, company-scoped.
export async function getFreightCostSummary(company, { from, to } = {}) {
  const conditions = ["p.company = ?", "pl.freight_amount IS NOT NULL"];
  const args = [company];
  if (from) { conditions.push('COALESCE(pl.dispatched_at, pl.updated_at) >= ?'); args.push(from); }
  if (to) { conditions.push('COALESCE(pl.dispatched_at, pl.updated_at) <= ?'); args.push(to); }
  return queryAll(
    `SELECT pl.packing_no, COALESCE(pl.dispatched_at, pl.updated_at) AS dispatched_at,
            pl.customer_name, pl.freight_amount, COALESCE(pl.freight_paid_by, 'us') AS freight_paid_by,
            strftime('%Y-%m', COALESCE(pl.dispatched_at, pl.updated_at)) AS month
       FROM packing_lists pl JOIN projects p ON p.id = pl.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY dispatched_at, pl.id`,
    args
  );
}

// Pending vs Dispatched Aging (plan §4) — the population the Dispatch Register (dispatched only)
// deliberately excludes: shipments still sitting, by age since creation.
export async function getDispatchAgingLines(company) {
  return queryAll(
    `SELECT pl.packing_no, pl.customer_name, pl.status, pl.created_at,
            CAST(julianday('now') - julianday(pl.created_at) AS INTEGER) AS days_open
       FROM packing_lists pl JOIN projects p ON p.id = pl.project_id
      WHERE p.company = ? AND pl.status != 'dispatched'
      ORDER BY days_open DESC`,
    [company]
  );
}

// Test Certificate Register (plan §4) — every cert, joined to whichever project(s) it's allocated
// to via certificate_projects (the same many-to-many getTestCertificates already reads), company-
// scoped through that join since test_certificates itself carries no company column.
export async function getTestCertificateRegisterLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('tc.created_at >= ?'); args.push(from); }
  if (to) { conditions.push('tc.created_at <= ?'); args.push(to); }
  return queryAll(
    `SELECT DISTINCT tc.id, tc.certificate_no, tc.cast_no, tc.plate_no, tc.material_spec, tc.steel_maker,
            tc.ys, tc.uts, tc.elongation, tc.bend_test, p.project_no
       FROM test_certificates tc
       JOIN certificate_projects cp ON cp.certificate_id = tc.id
       JOIN projects p ON p.id = cp.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY tc.id DESC`,
    args
  );
}

// Inspection Pass/Fail Summary (plan §4) — qc_records grouped by test_type, company-scoped through
// its own project_id (unlike test_certificates, qc_records already carries this directly).
export async function getQcInspectionSummary(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('qr.tested_on >= ?'); args.push(from); }
  if (to) { conditions.push('qr.tested_on <= ?'); args.push(to); }
  return queryAll(
    `SELECT qr.test_type,
            SUM(CASE WHEN qr.result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
            SUM(CASE WHEN qr.result = 'fail' THEN 1 ELSE 0 END) AS fail_count,
            SUM(CASE WHEN qr.result = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM qc_records qr JOIN projects p ON p.id = qr.project_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY qr.test_type
      ORDER BY qr.test_type`,
    args
  );
}

// Job-Work Inspection Register — company/period-scoped sibling of getJobWorkInspections(projectId)
// above, same relationship getQcInspectionSummary/getNcrRegisterLines have to their own per-project
// cousins. Reuses jobWorkVariance() rather than recomputing the sent/received gap a second way.
export async function getJobWorkInspectionRegisterLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('j.sent_date >= ?'); args.push(from); }
  if (to) { conditions.push('j.sent_date <= ?'); args.push(to); }
  const rows = await queryAll(
    `SELECT j.*, p.project_no FROM job_work_inspections j JOIN projects p ON p.id = j.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY j.sent_date DESC, j.id DESC`,
    args
  );
  return rows.map(r => ({ ...r, variance_qty: jobWorkVariance(r.sent_qty, r.received_qty) }));
}

// NCR Register (plan §5f) — company-scoped through the project join, same shape as getNcrs but
// filterable by date for the Report Engine's from/to controls.
export async function getNcrRegisterLines(company, { from, to } = {}) {
  const conditions = ['p.company = ?'];
  const args = [company];
  if (from) { conditions.push('n.raised_at >= ?'); args.push(from); }
  if (to) { conditions.push('n.raised_at <= ?'); args.push(to); }
  return queryAll(
    `SELECT n.*, p.project_no FROM ncr_records n JOIN projects p ON p.id = n.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.id DESC`,
    args
  );
}

// Resolves a material_issues row's bom_item -> its catalog item -> the tracked inventory_items row,
// the one join lib/inventory-costing.mjs's caller needs. Null when any hop is missing (the item was
// never picked from the catalog) — the issue simply isn't costed, not guessed at.
export async function getInventoryItemForBomItem(bomItemId) {
  return queryOne(
    `SELECT ii.* FROM bom_items b JOIN inventory_items ii ON ii.item_id = b.item_id
      WHERE b.id = ? AND b.item_id IS NOT NULL`,
    [bomItemId]
  );
}

// Bank reconciliation — every journal_entry_line posted against the Bank & Cash control account
// (1001), for the manual tick-off workflow. Reuses journal_entry_lines directly, no separate table.
export async function getBankLedgerLines(company, { from, to } = {}) {
  const conditions = ["je.company = ?", "je.status = 'posted'", "coa.code = '1001'"];
  const args = [company];
  if (from) { conditions.push('je.entry_date >= ?'); args.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); args.push(to); }
  return queryAll(
    `SELECT jel.id, jel.debit, jel.credit, jel.reconciled, jel.reconciled_at,
            je.entry_date, je.description, je.source_type, je.source_id
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY je.entry_date, jel.id`,
    args
  );
}
