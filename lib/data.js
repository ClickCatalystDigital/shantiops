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
  const bom = await queryAll('SELECT * FROM bom_items WHERE project_id = ? ORDER BY sort_order, id', [projectId]);
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

// Per-section BOM procurement rollup for one project. closed = CLOSED or RECEIVED; everything
// else (incl. no status yet) counts as pending. transit shown separately.
export async function getBomRollup(projectId) {
  const rows = await queryAll(
    `SELECT COALESCE(section, 'BOM') AS section, purchase_status, COUNT(*) AS n
       FROM bom_items WHERE project_id = ? GROUP BY section, purchase_status`, [projectId]);
  const bySection = {};
  for (const r of rows) {
    const s = (bySection[r.section] ||= { section: r.section, total: 0, closed: 0, transit: 0, pending: 0 });
    s.total += r.n;
    if (r.purchase_status === 'CLOSED' || r.purchase_status === 'RECEIVED') s.closed += r.n;
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
            SUM(CASE WHEN purchase_status IN ('CLOSED','RECEIVED') THEN 1 ELSE 0 END) AS closed
       FROM bom_items GROUP BY project_id`);
  const out = {};
  for (const r of rows) {
    out[r.project_id] = { total: r.total, closedPct: r.total ? Math.round((r.closed / r.total) * 100) : 0 };
  }
  return out;
}

// Open BOM work per project for a head's Operations view — the BOM analogue of getMyWork.
// Engineering sees projects with no BOM yet ("upload it"); Procurement/Stores/Production see
// how many items are still open (not CLOSED/RECEIVED). PM sees the open counts for everything.
export async function getBomWork(user) {
  const depts = isPM(user)
    ? ['Engineering', 'Procurement', 'Stores', 'Production']
    : headDepartments(user).filter(d => ['Engineering', 'Procurement', 'Stores', 'Production'].includes(d));
  if (!depts.length) return [];

  const rows = await queryAll(
    `SELECT p.id, p.project_no, p.customer_name,
            COUNT(b.id) AS total,
            SUM(CASE WHEN b.purchase_status IN ('CLOSED','RECEIVED') THEN 1 ELSE 0 END) AS closed
       FROM projects p LEFT JOIN bom_items b ON b.project_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id ORDER BY p.created_at DESC`);

  return rows
    .map(r => ({
      id: r.id, project_no: r.project_no, customer_name: r.customer_name,
      total: r.total, open: r.total - (r.closed || 0),
    }))
    .filter(r => (r.total === 0 ? depts.includes('Engineering') : r.open > 0));
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

// The three calendar layers for a date range, across one or more departments: ad-hoc tasks,
// milestones already scheduled on projects, and tickets (pilled on due_date, falling back to the
// day raised when there's no due date — a handoff always has one, from the receiving milestone's
// planned_end; a hand-raised ticket may not). from/to are grid bounds (lib/date.js
// monthGridBounds/weekBounds/yearBounds — whichever the caller's view needs).
export async function getDepartmentCalendar(departments, from, to) {
  const inDepts = departments.map(() => '?').join(',');
  const [tasks, milestones, tickets] = await Promise.all([
    queryAll(
      `SELECT id, title, due_date AS date, status, assigned_to, department
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
    queryAll(
      `SELECT t.id, t.kind, t.status, t.title, t.to_department, t.from_department, t.due_date,
              t.project_id, t.milestone_id, COALESCE(t.due_date, date(t.created_at)) AS date
         FROM tickets t
        WHERE (t.to_department IN (${inDepts}) OR t.from_department IN (${inDepts}))
          AND COALESCE(t.due_date, date(t.created_at)) BETWEEN ? AND ?
        ORDER BY date, t.id`,
      [...departments, ...departments, from, to]
    ),
  ]);
  return { tasks, milestones, tickets };
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

// Resolved-ticket count for the calendar's status strip, scoped to the exact same [from, to] the
// page already computed for the visible Month/Week/Year range — not a new range concept.
export async function getResolvedTicketCount(departments, from, to) {
  const inDepts = departments.map(() => '?').join(',');
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM tickets
      WHERE (to_department IN (${inDepts}) OR from_department IN (${inDepts}))
        AND status = 'done' AND date(closed_at) BETWEEN ? AND ?`,
    [...departments, ...departments, from, to]
  );
  return row?.n || 0;
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

// ---- Tickets + notifications ----

// The Nav bell's payload — polled every 20s on every page, so it stays two indexed scans.
export async function getNotifications(userId, limit = 20) {
  const [items, count] = await Promise.all([
    queryAll(
      `SELECT n.id, n.kind, n.ticket_id, n.title, n.body, n.read_at, n.created_at,
              t.project_id, t.status AS ticket_status
         FROM notifications n LEFT JOIN tickets t ON t.id = n.ticket_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`, [userId, limit]),
    queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]),
  ]);
  return { items, unread: count?.n || 0 };
}

// Tickets for the /tickets page and the per-department card. department = null → every department
// (PM oversight). A department sees both its inbox and what it raised — the two halves of a
// handoff read as one conversation, and hiding the outbox makes "did they pick it up?" unanswerable.
// ORDER BY: open before done (SQLite sorts false<true), then soonest due, then newest.
export async function getTickets({ department = null, projectId = null, status = null } = {}) {
  const where = [], args = [];
  if (department) { where.push('(t.to_department = ? OR t.from_department = ?)'); args.push(department, department); }
  if (projectId)  { where.push('t.project_id = ?'); args.push(projectId); }
  if (status)     { where.push('t.status = ?'); args.push(status); }
  return queryAll(
    `SELECT t.*, p.project_no, p.customer_name, m.milestone_label
       FROM tickets t
       LEFT JOIN projects p   ON p.id = t.project_id
       LEFT JOIN milestones m ON m.id = t.milestone_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.status = 'done', COALESCE(t.due_date, '9999-12-31'), t.id DESC`,
    args);
}
