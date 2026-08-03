// lib/db.js
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { MILESTONE_TEMPLATE } from './milestones';
import { SF_FORM_IVA_PARTS, SF_SEED_CERTIFICATES, findSeedCertKey } from './qc-template.mjs';

let db = null;
let initPromise = null;

function getClient() {
  if (db) return db;
  if (process.env.TURSO_URL) {
    db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      intMode: 'number'
    });
  } else {
    db = createClient({ url: 'file:./shanti-ops-local.db', intMode: 'number' });
  }
  return db;
}

async function migrate(client) {
  // Redesign flatten (confirmed): Project → Unit → Milestone becomes Project → Milestone, flat.
  // The old unit-scoped rows don't map onto the new flat model, so — since this is demo data only —
  // wipe and let seedIfEmpty() rebuild everything fresh the first time this runs against an old DB.
  const oldSchema = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='project_units'");
  if (oldSchema.rows.length) {
    for (const t of ['milestones', 'project_units', 'packing_items', 'packing_lists', 'projects', 'users', 'counters']) {
      await client.execute(`DROP TABLE IF EXISTS ${t}`);
    }
  }

  // role: admin | manager | operator (internal) | customer (external, scoped to project_id).
  await client.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    project_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // A project = one customer order (e.g. SB-1018). Mirrors the packing list header.
  // owner = responsible PM. order_value feeds the exec "value in progress" KPI (optional).
  await client.execute(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    description TEXT,
    order_date DATE,
    order_value REAL,
    status TEXT NOT NULL DEFAULT 'active',
    owner TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // One row per milestone per project — flat, no intermediate unit layer (redesign §4).
  // milestone_key/label/sort_order come from lib/milestones.js and are seeded automatically
  // whenever a project is created.
  await client.execute(`CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    milestone_key TEXT NOT NULL,
    milestone_label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    assignee TEXT,
    department TEXT,
    planned_start DATE,
    planned_end DATE,
    actual_start DATE,
    actual_end DATE,
    status TEXT NOT NULL DEFAULT 'pending',
    delay_reason TEXT,
    delay_category TEXT,
    vendor TEXT,
    po_no TEXT,
    material_ready INTEGER NOT NULL DEFAULT 0,
    qc_ok INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    depends_on_key TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Set when a milestone is sent back for rework after already being closed (POST
  // /api/milestones/[id]/reopen) — lets the tracker read "Reopened" instead of silently looking
  // like plain in-progress work. reopen_reason/reopened_by are the human's own words + who filed
  // it; reopen_count feeds the notification dedupe key so a second reopen-and-reclose cycle still
  // notifies downstream (a real gap in the old ticket-based flow — source_key was UNIQUE forever).
  await addColumn(client, 'milestones', 'reopened_at DATETIME');
  await addColumn(client, 'milestones', 'reopen_reason TEXT');
  await addColumn(client, 'milestones', 'reopened_by TEXT');
  await addColumn(client, 'milestones', 'reopen_count INTEGER NOT NULL DEFAULT 0');

  // Packing lists — the auto-generated replacement for the manual PDF.
  await client.execute(`CREATE TABLE IF NOT EXISTS packing_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    packing_no TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_address TEXT,
    invoice_no TEXT,
    invoice_date DATE,
    package_type TEXT,
    dc_no TEXT,
    dc_date DATE,
    vehicle_no TEXT,
    dispatch_through TEXT,
    contact_person TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Line items — fields mirror the columns on the Shanti Boilers master packing list.
  await client.execute(`CREATE TABLE IF NOT EXISTS packing_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    packing_list_id INTEGER NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
    s_no INTEGER,
    material_description TEXT NOT NULL,
    moc TEXT,
    size_spec TEXT,
    ibr_no TEXT,
    item_code TEXT,
    box_no TEXT,
    qty REAL NOT NULL DEFAULT 1,
    unit TEXT DEFAULT "No's",
    make TEXT,
    scanned_qty REAL NOT NULL DEFAULT 0
  )`);

  await client.execute(`CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 1000
  )`);

  const seeded = await client.execute({ sql: "SELECT value FROM counters WHERE name = 'project_no'", args: [] });
  if (!seeded.rows.length) {
    await client.execute({ sql: "INSERT INTO counters (name, value) VALUES ('project_no', 1000)", args: [] });
  }
  const seeded2 = await client.execute({ sql: "SELECT value FROM counters WHERE name = 'packing_no'", args: [] });
  if (!seeded2.rows.length) {
    await client.execute({ sql: "INSERT INTO counters (name, value) VALUES ('packing_no', 1000)", args: [] });
  }

  await client.execute(`CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_milestones_planned_end ON milestones(planned_end)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_packing_project ON packing_lists(project_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_packing_items_list ON packing_items(packing_list_id)`);

  // Redesign additive migrations — safe to re-run (addColumn ignores "duplicate column").
  await addColumn(client, 'users', 'departments TEXT');          // CSV of department names a head is granted
  await addColumn(client, 'users', 'display_name TEXT');
  await addColumn(client, 'users', 'contact_number TEXT');
  await addColumn(client, 'users', 'active INTEGER NOT NULL DEFAULT 1');
  await addColumn(client, 'users', 'project_ids TEXT');          // CSV — a customer may own several projects
  await addColumn(client, 'users', 'pending INTEGER NOT NULL DEFAULT 0'); // self-registered, awaiting approval
  await addColumn(client, 'packing_items', 'bom_item_id INTEGER'); // reconciliation link back to the BOM row
  await addColumn(client, 'packing_items', 'section TEXT');        // free-text group (Boiler / Chimney / Ducting)

  // BOM — flat, one list per project. Feeds the auto-generated draft packing list.
  await client.execute(`CREATE TABLE IF NOT EXISTS bom_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    material_description TEXT NOT NULL,
    moc TEXT,
    size_spec TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_bom_project ON bom_items(project_id)`);

  // v4: PMB (Project Master BOM) Excel import. Each upload is kept whole — the .xlsx blob IS the
  // revision record (files are ~50-120 KB). bom_items grows spreadsheet-mirror columns, all free
  // text by design: departments edit text, the app never parses dates/qty except display counts.
  await client.execute(`CREATE TABLE IF NOT EXISTS bom_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file BLOB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    summary TEXT,
    imported_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_bom_imports_project ON bom_imports(project_id)`);
  await addColumn(client, 'bom_items', 'section TEXT');           // sheet name: BOILER / SDC / ID FAN…
  await addColumn(client, 'bom_items', 'group_label TEXT');       // in-sheet assembly heading row text
  await addColumn(client, 'bom_items', 'make TEXT');
  await addColumn(client, 'bom_items', 'qty_text TEXT');          // "2 Nos", "6 Mtrs" — as written
  await addColumn(client, 'bom_items', 'purchase_status TEXT');   // PENDING | TRANSIT | CLOSED | RECEIVED | null
  await addColumn(client, 'bom_items', 'pr_ref TEXT');            // PR no & date, raw
  await addColumn(client, 'bom_items', 'po_ref TEXT');
  await addColumn(client, 'bom_items', 'grn_ref TEXT');
  await addColumn(client, 'bom_items', 'grn_qty_text TEXT');
  await addColumn(client, 'bom_items', 'pending_qty_text TEXT');
  await addColumn(client, 'bom_items', 'bqtc_ref TEXT');
  await addColumn(client, 'bom_items', 'issued_ref TEXT');        // Production: issued + date
  await addColumn(client, 'bom_items', 'received_ref TEXT');      // Production: received qty + date
  await addColumn(client, 'bom_items', 'remarks TEXT');
  await addColumn(client, 'bom_items', 'import_id INTEGER');      // → bom_imports; null = pasted/added row

  // QC test/inspection records — hydro test, radiography/NDE, material test certificates (MTC),
  // one row per test. Whole-row department ownership (QC + PM), unlike bom_items' field-level
  // scoping — there's no other department that needs to write part of a QC record.
  await client.execute(`CREATE TABLE IF NOT EXISTS qc_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_type TEXT NOT NULL,
    reference_no TEXT,
    result TEXT NOT NULL DEFAULT 'pending',
    inspector TEXT,
    tested_on DATE,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_qc_records_project ON qc_records(project_id)`);

  // USB device approval — a Windows agent per machine blocks USB storage and files requests here.
  await client.execute(`CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    active INTEGER NOT NULL DEFAULT 1,
    last_seen DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS usb_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    serial TEXT NOT NULL DEFAULT '',
    label TEXT,
    whitelisted INTEGER NOT NULL DEFAULT 0,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, product_id, serial)
  )`);
  // status: pending | approved | rejected | revoked — 'expired' is derived at read time (lib/usb.js).
  // expires_at is epoch ms to avoid SQLite datetime-string comparison pitfalls.
  await client.execute(`CREATE TABLE IF NOT EXISTS usb_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    device_id INTEGER NOT NULL REFERENCES usb_devices(id),
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME,
    decided_by TEXT,
    expires_at INTEGER
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_usb_requests_machine ON usb_requests(machine_id)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS usb_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    machine_id INTEGER,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // TOTP state for approvers (pending secret keeps a mis-scan from clobbering a working one).
  await addColumn(client, 'users', 'totp_secret TEXT');
  await addColumn(client, 'users', 'totp_pending_secret TEXT');
  await addColumn(client, 'users', 'totp_fails INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'users', 'totp_lock_until INTEGER');
  await addColumn(client, 'users', 'totp_last_code TEXT');

  // v2: device kind (usb | cd, room for phone/printer/... later) + agent version reporting.
  await addColumn(client, 'usb_devices', "kind TEXT NOT NULL DEFAULT 'usb'");
  await addColumn(client, 'machines', 'agent_version TEXT');

  // v3: browser policy engine. approval_policies is generic (kind='browser' now, 'application' later);
  // target is a normalized domain. browser_requests mirrors usb_requests but keyed by domain, and
  // reuses lib/usb.js effectiveStatus/verifyTotp/audit + the generic usb_audit table.
  await client.execute(`CREATE TABLE IF NOT EXISTS approval_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, target)
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS browser_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME,
    decided_by TEXT,
    expires_at INTEGER
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_browser_requests_machine ON browser_requests(machine_id)`);

  // v3 setup: zero-typing enrollment — a short single-use code redeemed for the machine token.
  await addColumn(client, 'machines', 'enroll_code TEXT');
  await addColumn(client, 'machines', 'enroll_expires INTEGER');
  await addColumn(client, 'machines', 'enrolled_at DATETIME');

  // Every department's ad-hoc task list on a month calendar, plus (Production only) a daily
  // worker sheet. Distinct from milestones, which are a fixed per-project template with no
  // create/delete — these are free-form day-to-day work. assigned_to is a username string,
  // matching the milestones.assignee convention (no FK to users anywhere in this schema).
  await client.execute(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',       -- open | done
    department TEXT NOT NULL DEFAULT 'Production',
    assigned_to TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`);
  // Cross-department raises now land here instead of in a separate tickets entity: a task with
  // from_department set is one department asking another for something (a plain request, or
  // rework aimed at Engineering/Stores, who own no milestones to reopen — see the reopen endpoint
  // for the milestone-owning-department case). project_id is optional context, not a scope —
  // Operations-level asks have none.
  await addColumn(client, 'tasks', 'from_department TEXT');
  await addColumn(client, 'tasks', 'project_id INTEGER');       // -> projects.id; no FK clause in ADD
                                                                 // COLUMN, same convention as bom_item_id
  // A task with bom_item_id set is a Procurement cancel-request (§ cancel-request flow): Design
  // asking Procurement to cancel one specific BOM line. It's a plain cross-department task in
  // every other respect — this column is the only thing that distinguishes it, so there's no
  // separate "kind" enum for one use case. Accepting it (app/api/production/tasks/
  // accept-cancellations) marks the task done and flips the item's purchase_status to CANCELLED.
  await addColumn(client, 'tasks', 'bom_item_id INTEGER');      // -> bom_items.id; same no-FK convention

  // Shop-floor workers. These people never log in and have no users row — operators fill the
  // sheet in for them. trade = Welder / Fitter / Helper. Never deleted, only deactivated, so
  // worker_days history survives.
  await client.execute(`CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    trade TEXT,
    department TEXT NOT NULL DEFAULT 'Production',
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Exactly one row per worker per day: attendance plus the one thing they worked on. The UNIQUE
  // key is what lets the whole card save as a single idempotent upsert — see
  // app/api/production/worker-days, which must be sent the complete row every time.
  await client.execute(`CREATE TABLE IF NOT EXISTS worker_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'present',    -- present | half | absent
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(worker_id, date)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_worker_days_date ON worker_days(date)`);

  // ponytail: dead table, kept only for FK integrity (notifications.ticket_id) and history — no
  // code writes to it anymore. Cross-department signals now split across two things that already
  // existed: a plain notification (the signal) plus, where there's real state to carry, either the
  // milestone itself (reopened_at/reopen_reason/reopen_count above) or a `tasks` row
  // (from_department/project_id above) for the two departments — Engineering, Stores — that own no
  // milestones to reopen. See SYSTEM.md §3b for the pre-collapse history if this table's shape
  // ever needs explaining. Safe to DROP TABLE once nobody needs the 8 historical rows or the old
  // ticket_status_change audit entries to make sense.
  await client.execute(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                           -- handoff | rework | request
    source_key TEXT UNIQUE,                       -- idempotency; NULL for hand-raised
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
    from_department TEXT,                         -- who raised it (NULL = raised by a PM)
    to_department TEXT NOT NULL,                  -- who owes the work
    assigned_to TEXT,                             -- optional username, matching milestones.assignee
    title TEXT NOT NULL,
    body TEXT,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'open',          -- open | done
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_by TEXT,
    closed_at DATETIME
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_to ON tickets(to_department, status)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id)`);

  // Notifications are fanned out — one row per recipient, not an events table plus a per-user
  // reads join. Under 20 internal users and at most 3 recipients per department, so the write is
  // trivial, and it makes the bell's two queries (unread COUNT, latest 20) single-table index
  // scans with no join, and mark-read a plain UPDATE.
  // dedupe_key is what makes a repeat safe: 'overdue:<ticket_id>:<YYYY-MM-DD>' (Phase 2). NULL for
  // one-shot event notifications, which must never be deduped.
  await client.execute(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                           -- handoff | rework | request | assigned | overdue
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    dedupe_key TEXT,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, dedupe_key)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)`);
  // ticket_id is dead (see the tickets table comment above) — kept, never written, for the 8
  // historical rows. milestone_id/task_id are what a notification's "open" link resolves through
  // now (lib/data.js getNotifications), covering the handoff/reopen/raised-task cases respectively.
  await addColumn(client, 'notifications', 'milestone_id INTEGER');
  await addColumn(client, 'notifications', 'task_id INTEGER');

  // Workflow Stages — a reusable, department-defined checklist layer *under* a milestone (Open →
  // Current → Closed), not a second workflow hierarchy competing with milestones. stage_templates
  // is a named, reusable template *header* — a department can save several named templates per
  // (department, milestone_key) (e.g. "Standard" vs "Fast-track"), one marked is_default. The
  // default auto-copies onto every matching milestone the moment a project is created
  // (createProjectMilestones, below); any template can also be applied on demand later (a
  // milestone that predates this feature, or a head picking a non-default one). stage_template_items
  // is the ordered stage list under one template. milestone_stages is the actual per-milestone
  // instance list — editing it (or a template) never touches the other; a template is shaped by
  // explicitly saving/editing it, not grown implicitly from instance edits.
  //
  // v1 of this table (one flat row per stage label, no name/is_default) never shipped past this
  // session's own testing — empty in every environment — so this is a guarded drop-and-recreate
  // (same idiom as the redesign-flatten wipe at the top of this function) rather than an additive
  // migration for a shape nobody has real data in yet.
  const oldStageTemplates = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='stage_templates'");
  if (oldStageTemplates.rows.length && !String(oldStageTemplates.rows[0].sql).includes('is_default')) {
    await client.execute('DROP TABLE stage_templates');
  }
  await client.execute(`CREATE TABLE IF NOT EXISTS stage_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT NOT NULL,
    milestone_key TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(department, milestone_key, name)
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS stage_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES stage_templates(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS milestone_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    milestone_id INTEGER NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',   -- open | current | closed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_milestone_stages_milestone ON milestone_stages(milestone_id)`);

  // Procurement system — suppliers, an append-only quote log, and structured purchase orders that
  // can span multiple projects (the same MS angle gets bought once for several boilers, not
  // per-project). suppliers is deliberately provisional: the client's real supplier list is coming
  // separately and will be mapped onto this additively — UNIQUE(name) exists now specifically so
  // "Kirloskar" / "Kirloskar Bros" don't drift into two rows before that happens.
  await client.execute(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    gst_no TEXT,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    default_payment_terms TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Never mutated after insert — this is the price-history log ("track each item per supplier per
  // timestamp"), and the eventual substrate for a supplier-facing portal. batch_id groups the rows
  // from one "supplier quoted N items at once" entry; NULL for a single-item quote. valid_until and
  // project_id are here now so a future "does this quote expire" / cross-project rollup doesn't need
  // a schema change later, even though neither is used yet.
  await client.execute(`CREATE TABLE IF NOT EXISTS supplier_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    bom_item_id INTEGER NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    project_id INTEGER,
    unit_price REAL NOT NULL,
    uom TEXT,
    expected_delivery_days INTEGER,
    payment_terms TEXT,
    quote_source TEXT,                     -- whatsapp | email | phone | ...
    valid_until DATE,
    notes TEXT,
    batch_id TEXT,
    quoted_by TEXT,
    quoted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_supplier_quotes_item ON supplier_quotes(bom_item_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier ON supplier_quotes(supplier_id)`);
  // Sourcing's Expected Delivery is a calendar date now (§4.1), not a day-count — added alongside
  // the original expected_delivery_days rather than replacing it, so old rows stay readable.
  await addColumn(client, 'supplier_quotes', 'expected_delivery_date DATE');
  // The winning quote for a BOM line — NULL means nobody's been picked yet, which is what "still
  // needs sourcing" means throughout the Procurement workspace. Set/cleared only through
  // POST/DELETE /api/bom-items/[id]/select-supplier, never the generic BOM PATCH.
  await addColumn(client, 'bom_items', 'selected_quote_id INTEGER');

  // po_no is a single global sequence (a PO can span projects) formatted as NNN/SB/YYYY-YY by the
  // route, mirroring the real hand-made POs (578/SB/2025-26, 562/SB/2026-27). is_split marks the
  // deliberate "one line, two suppliers" exception — appends "(split-po)" on the PDF, same as the
  // real sample. Every other terms/logistics field defaults to what's on every sample PO today
  // (delivery IMMEDIATELY, transport Our Scope, freight To Pay Basis, guarantee NA) so issuing one
  // is mostly just picking a supplier and items.
  await client.execute(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_no TEXT NOT NULL UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | issued | cancelled
    is_split INTEGER NOT NULL DEFAULT 0,
    quote_source TEXT,
    quote_date DATE,
    indent_ref TEXT,
    delivery_address TEXT,
    payment_terms TEXT,
    delivery_schedule TEXT DEFAULT 'IMMEDIATELY',
    transportation TEXT DEFAULT 'Our Scope',
    freight TEXT DEFAULT 'To Pay Basis',
    guarantee TEXT DEFAULT 'NA',
    discount_pct REAL NOT NULL DEFAULT 0,
    gst_pct REAL NOT NULL DEFAULT 18,
    special_instructions TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    issued_at DATETIME,
    cancelled_at DATETIME,
    cancel_reason TEXT
  )`);
  // Snapshot at PO-creation time, same precedent as packing_items snapshotting bom_items — an
  // issued PO's lines never silently change if the BOM row is edited afterward.
  await client.execute(`CREATE TABLE IF NOT EXISTS po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    bom_item_id INTEGER REFERENCES bom_items(id),
    project_id INTEGER,
    description TEXT NOT NULL,
    qty REAL NOT NULL,
    uom TEXT,
    rate REAL NOT NULL,
    amount REAL NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_po_items_po ON po_items(po_id)`);

  // Seed the po_no counter at the real business's current number (see the sample POs) so freshly
  // generated numbers continue the real sequence instead of restarting at 1000 like the demo
  // counters — this one isn't a demo id, it's meant to be a real, continuing document number.
  const poCounterSeeded = await client.execute({ sql: "SELECT value FROM counters WHERE name = 'po_no'", args: [] });
  if (!poCounterSeeded.rows.length) {
    await client.execute({ sql: "INSERT INTO counters (name, value) VALUES ('po_no', 578)", args: [] });
  }

  // Procurement redesign (PROCUREMENT-CHANGES.md §4.0) — a new-item request from Engineering/Design,
  // raised via TicketsPanel's "Request procurement" kind. Deliberately not a bom_items row yet: it
  // only materializes into one (purchase_status='PENDING', via bom_item_id here) once Procurement
  // accepts it in the Requests tab — that acceptance is what makes it visible anywhere in
  // Procurement. A *cancel* request is NOT stored here — it keeps the existing, already-working
  // tasks.bom_item_id + accept-cancellations flow; the Requests tab's inbox just displays both kinds
  // side by side from their two different backing sources.
  await client.execute(`CREATE TABLE IF NOT EXISTS procurement_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_department TEXT NOT NULL,
    material_description TEXT NOT NULL,
    moc TEXT,
    size_spec TEXT,
    qty_text TEXT,
    pr_ref TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
    created_by TEXT NOT NULL,
    accepted_by TEXT,
    bom_item_id INTEGER,                       -- set on accept, the materialized row
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_procurement_requests_status ON procurement_requests(status)`);

  // QC V1 (QC-CHANGES.md) — Test Certificate bank, cross-project (a plate is bought once and cut
  // into parts for many boilers, same precedent as suppliers/purchase_orders above), plus the
  // per-boiler statutory document that references it. Chemistry belongs to the cast/heat; physical
  // properties belong to the rolled plate — confirmed against the real sample, where one cast spans
  // two plates with identical chemistry but different yield/UTS. No UNIQUE constraint on
  // (certificate_no, cast_no, plate_no): plate_no is often NULL (forged fittings have no plate), and
  // SQLite treats every NULL as distinct, so a DB constraint couldn't catch the real duplicate case
  // anyway — the exact-match check lives in the API instead (POST /api/test-certificates).
  await client.execute(`CREATE TABLE IF NOT EXISTS test_certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_no TEXT NOT NULL,
    cast_no TEXT NOT NULL,
    plate_no TEXT,
    material_spec TEXT NOT NULL,
    steel_maker TEXT NOT NULL,
    size_t TEXT,
    size_w TEXT,
    size_l TEXT,
    chem_c TEXT, chem_mn TEXT, chem_p TEXT, chem_s TEXT, chem_si TEXT,
    ys TEXT, uts TEXT, elongation TEXT, bend_test TEXT DEFAULT 'OK',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // One statutory document per boiler (doc_id e.g. SBH-1037-SF-WB-300-17). V1 covers Form IV A only
  // (QC V1 plan §7) — series is stored for future forms/series but only 'SF' is usable today.
  await client.execute(`CREATE TABLE IF NOT EXISTS qc_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    series TEXT NOT NULL DEFAULT 'SF',
    doc_id TEXT NOT NULL,
    makers_no TEXT,
    year_of_make TEXT,
    boiler_type TEXT,
    length_overall TEXT,
    internal_diameter TEXT,
    design_pressure TEXT,
    hydro_test_pressure TEXT,
    heating_surface TEXT,
    evaporation_capacity TEXT,
    steam_temp TEXT,
    drawing_no TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_qc_documents_project ON qc_documents(project_id)`);

  // Form IV A part rows — seeded whole from SF_FORM_IVA_PARTS when a document is created (QC V1
  // plan §8 assumption 1, client-confirmed: every new SF document auto-copies the same 54-part
  // template rather than building the list by hand). test_certificate_id NULL = unlinked, which is
  // the save-time PDF gate (POST /api/qc-documents/[id]/pdf refuses while any row is NULL here).
  await client.execute(`CREATE TABLE IF NOT EXISTS qc_document_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES qc_documents(id) ON DELETE CASCADE,
    part_no TEXT,
    part_name TEXT NOT NULL,
    size_t TEXT, size_w TEXT, size_l TEXT,
    qty TEXT,
    test_certificate_id INTEGER REFERENCES test_certificates(id),
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_qc_document_parts_document ON qc_document_parts(document_id)`);

  await seedIfEmpty(client);
  await seedQcDemoData(client);
}

// Add a column if it doesn't already exist. libsql throws "duplicate column name" on re-run — ignore that.
async function addColumn(client, table, columnDef) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    if (!String(e).toLowerCase().includes('duplicate column')) throw e;
  }
}

// QC V1 demo data — the 17 real certificates from the client's own SB-1037 sample, so the TC
// bank's reuse story (54 parts / 17 certs) is real on first run, not invented. Separately, if the
// demo project (SB-1018, seeded above) exists and has no QC document yet, seed one whole SF
// document using the same real SB-1037 boiler numbers and the 54-part template, auto-linking every
// part to its matching seeded certificate EXCEPT the last 6 (STAND PIPE N6–N12) — left unlinked on
// purpose so the demo has something live to link, and to show the save-time gate actually blocking.
// Both halves are guarded independently and safe to re-run (each only inserts once, ever).
async function seedQcDemoData(client) {
  const certCount = await client.execute('SELECT COUNT(*) AS n FROM test_certificates');
  let certIds = [];
  if (certCount.rows[0].n === 0) {
    for (const c of SF_SEED_CERTIFICATES) {
      const res = await client.execute({
        sql: `INSERT INTO test_certificates
                (certificate_no, cast_no, plate_no, material_spec, steel_maker, size_t, size_w, size_l,
                 chem_c, chem_mn, chem_p, chem_s, chem_si, ys, uts, elongation, bend_test, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qc_head')`,
        args: [c.certificate_no, c.cast_no, c.plate_no, c.material_spec, c.steel_maker,
          c.size_t, c.size_w, c.size_l, c.chem_c, c.chem_mn, c.chem_p, c.chem_s, c.chem_si,
          c.ys, c.uts, c.elongation, c.bend_test]
      });
      certIds.push(Number(res.lastInsertRowid));
    }
  } else {
    const rows = await client.execute(
      'SELECT id, certificate_no, cast_no, plate_no FROM test_certificates ORDER BY id');
    // Re-derive certIds in SF_SEED_CERTIFICATES order so the document-seed step below (which only
    // runs once, on a fresh DB) still lines up if this ever runs twice in the same migration.
    certIds = SF_SEED_CERTIFICATES.map(c => {
      const r = rows.rows.find(x => x.certificate_no === c.certificate_no && x.cast_no === c.cast_no
        && (x.plate_no || null) === (c.plate_no || null));
      return r ? r.id : null;
    });
  }

  const docCount = await client.execute('SELECT COUNT(*) AS n FROM qc_documents');
  if (docCount.rows[0].n > 0) return;
  const demoProject = await client.execute(
    "SELECT id FROM projects WHERE project_no = 'SB-1018'");
  if (!demoProject.rows.length) return;
  const projectId = demoProject.rows[0].id;

  const doc = await client.execute({
    sql: `INSERT INTO qc_documents
            (project_id, series, doc_id, makers_no, year_of_make, boiler_type, length_overall,
             internal_diameter, design_pressure, hydro_test_pressure, heating_surface,
             evaporation_capacity, steam_temp, drawing_no, created_by)
          VALUES (?, 'SF', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qc_head')`,
    args: [projectId, 'SBH-1037-SF-WB-300-17', 'SB-1037', '2024',
      'HORIZONTAL MULTITUBULAR SHELL TYPE SMOKE TUBE WET BACK BOILER', '3673 mm', '2450 mm (ID)',
      '17.00 Kg/cm² (g)', '25.50 Kg/cm² (g)', '105.24 Sq.mtrs.', '3000 Kg./hr. From & at 100°',
      '195° C', 'SB-1037-00-01']
  });
  const documentId = Number(doc.lastInsertRowid);

  const UNLINKED_FROM_PART_NO = 49; // STAND PIPE N6 onward — left open for the live demo
  for (let i = 0; i < SF_FORM_IVA_PARTS.length; i++) {
    const p = SF_FORM_IVA_PARTS[i];
    const leaveUnlinked = Number(p.part_no) >= UNLINKED_FROM_PART_NO;
    const certIdx = findSeedCertKey(p.cert_key);
    const certId = leaveUnlinked || certIdx === -1 ? null : certIds[certIdx];
    await client.execute({
      sql: `INSERT INTO qc_document_parts
              (document_id, part_no, part_name, size_t, size_w, size_l, qty, test_certificate_id, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [documentId, p.part_no, p.part_name, p.size_t, p.size_w, p.size_l, p.qty, certId, i]
    });
  }
}

// Seed a default admin + a demo project so the app is usable/demo-able on first run.
// ponytail: fixed default creds for the demo; change ADMIN_PASSWORD env for a real deploy.
async function seedIfEmpty(client) {
  const users = await client.execute("SELECT COUNT(*) AS n FROM users");
  if (users.rows[0].n > 0) return;

  const mk = (u, pw, role, projectId, departments = null, displayName = null, projectIds = null) => client.execute({
    sql: `INSERT INTO users (username, password, role, project_id, departments, display_name, project_ids)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [u, bcrypt.hashSync(pw, 10), role, projectId, departments, displayName, projectIds]
  });
  const adminPw = process.env.ADMIN_PASSWORD || 'admin123';
  await mk('admin', adminPw, 'admin', null, null, 'Admin (PM)');
  await mk('manager', 'manager123', 'manager', null, null, 'Project Manager');
  await mk('executive', 'executive123', 'executive', null, null, 'Executive'); // approves PM registrations
  // Functional heads — one per department, username <dept>_head / password <username>123,
  // scoped to their department via the access matrix. (Engineering abbreviates to engg_head.)
  for (const [username, dept] of Object.entries(HEAD_USERS)) {
    await mk(username, `${username}123`, 'operator', null, dept, `${dept} Head`);
  }

  // Demo project SB-1018 (matches the sample packing list) with three units + milestones.
  const proj = await client.execute({
    sql: `INSERT INTO projects (project_no, customer_name, description, order_date, order_value, owner)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['SB-1018', 'Asian Brown Bleachchem P Ltd', '3 TPH Solid Fuel Fired Boiler', '2026-04-15', 4200000, 'manager']
  });
  const projectId = Number(proj.lastInsertRowid);
  // Flat 25-stage milestone chain (redesign §4 — no unit layer). Staggered start tells a realistic
  // story: completed → an overdue/blocked vendor bottleneck → in progress → upcoming.
  await createProjectMilestones(client, projectId, 46);

  // Customers: one login per company, scoped to however many projects they own (project_ids CSV).
  // On a fresh DB only SB-1018 exists — HKM/Virchow accounts seed with an empty order list; the
  // live-DB migration script wires their real project ids once those projects are imported.
  await mk('asian_brown', 'asian_brown123', 'customer', projectId, null, 'Asian Brown Bleachchem', String(projectId));
  await mk('hkm_charitable', 'hkm_charitable123', 'customer', null, null, 'HKM Charitable', '');
  await mk('virchow_biotech', 'virchow_biotech123', 'customer', null, null, 'Virchow Biotech P Ltd', '');
  await seedDemoPackingList(client, projectId);

  // Advance the counters past the seeded numbers.
  await client.execute("UPDATE counters SET value = 1018 WHERE name = 'project_no'");
  await client.execute("UPDATE counters SET value = 1001 WHERE name = 'packing_no'");
}

// One functional-head login per department: username → department.
const HEAD_USERS = {
  design_head: 'Design',
  engg_head: 'Engineering',
  procurement_head: 'Procurement',
  stores_head: 'Stores',
  production_head: 'Production',
  qc_head: 'QC',
  dispatch_head: 'Dispatch',
  installation_head: 'Installation',
};

// Which operator owns each department's work, so "My Work" is populated.
const DEPT_ASSIGNEE = {
  Design: 'design_head', Procurement: 'procurement_head', Production: 'production_head',
  QC: 'qc_head', Dispatch: 'dispatch_head', Installation: 'installation_head',
};
const DELAY_REASONS = ['Pump vendor delay', 'Awaiting client drawing approval', 'MS plate shortage'];
const DEPT_DELAY_CAT = { Procurement: 'Vendor', Production: 'Material', Design: 'Design', QC: 'Other', Dispatch: 'Material', Installation: 'Customer' };

// Seed one flat milestone row per template entry directly under the project.
// startDaysAgo = null -> no dates (blank template). A number -> lay 3-day planned bars end-to-end
// starting that many days before today (negative = starts in the future).
// demoStory = true additionally paints a realistic status story (completed → one overdue/blocked
// bottleneck with delay category → current in-progress → upcoming) plus fake vendor/PO data —
// seed-demo only. Real projects (created via POST /api/projects) use demoStory = false: planned
// dates laid out, every status pending, no fabricated data — the PM adjusts from there.
export async function createProjectMilestones(client, projectId, startDaysAgo, demoStory = true) {
  const N = MILESTONE_TEMPLATE.length;

  // First pass: compute planned start/end for every milestone.
  const plan = [];
  if (startDaysAgo != null) {
    let cursor = Date.now() - startDaysAgo * 864e5;
    for (let i = 0; i < N; i++) {
      const ps = new Date(cursor).toISOString().slice(0, 10);
      cursor += 3 * 864e5;
      const pe = new Date(cursor).toISOString().slice(0, 10);
      cursor += 864e5; // 1-day gap between milestones
      plan.push({ ps, pe });
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  // The "current" milestone is the first one still planned to finish today or later.
  let curIdx = plan.findIndex(p => p.pe >= todayStr);
  if (curIdx === -1) curIdx = N; // everything is in the past

  for (let i = 0; i < N; i++) {
    const m = MILESTONE_TEMPLATE[i];
    const assignee = DEPT_ASSIGNEE[m.department] || null;
    let ps = null, pe = null, as = null, ae = null, status = 'pending';
    let reason = null, delayCat = null, vendor = null, poNo = null, materialReady = 0, qcOk = 0;

    if (demoStory && m.category === 'procurement') { vendor = 'Thermax Ltd'; poNo = `PO-${1000 + i}`; }

    if (plan.length) {
      ({ ps, pe } = plan[i]);
      if (!demoStory) {                           // real project: dates only, all pending
      } else if (i < curIdx - 1) {                // completed on time
        status = 'done'; as = ps; ae = pe;
        if (m.category === 'procurement') materialReady = 1;
        if (m.category === 'qc') qcOk = 1;
      } else if (i === curIdx - 1) {              // the bottleneck (overdue / blocked)
        status = 'blocked'; as = ps;
        reason = DELAY_REASONS[projectId % DELAY_REASONS.length];
        delayCat = DEPT_DELAY_CAT[m.department] || 'Other';
        if (m.category === 'procurement') { vendor = 'Kirloskar Bros'; materialReady = 0; }
      } else if (i === curIdx) {                  // current work
        status = 'in_progress'; as = ps;
      }
    }
    const inserted = await client.execute({
      sql: `INSERT INTO milestones
              (project_id, milestone_key, milestone_label, sort_order, assignee, department,
               planned_start, planned_end, actual_start, actual_end, status,
               delay_reason, delay_category, vendor, po_no, material_ready, qc_ok)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [projectId, m.key, m.label, i, assignee, m.department,
        ps, pe, as, ae, status, reason, delayCat, vendor, poNo, materialReady, qcOk]
    });
    await copyDefaultStageTemplate(client, Number(inserted.lastInsertRowid), m.department, m.key);
  }
}

// Workflow Stages (§3c): the moment a milestone is created — a brand-new project, PM or demo seed
// alike — copy whichever stage_template is marked default for its (department, milestone_key), if
// one exists. A no-op on a fresh DB (no templates yet) or for a type nobody's defined a default for.
async function copyDefaultStageTemplate(client, milestoneId, department, milestoneKey) {
  const tpl = await client.execute({
    sql: `SELECT id FROM stage_templates WHERE department = ? AND milestone_key = ? AND is_default = 1`,
    args: [department, milestoneKey]
  });
  if (!tpl.rows.length) return;
  const items = await client.execute({
    sql: `SELECT label, sort_order FROM stage_template_items WHERE template_id = ? ORDER BY sort_order`,
    args: [tpl.rows[0].id]
  });
  for (const it of items.rows) {
    await client.execute({
      sql: `INSERT INTO milestone_stages (milestone_id, label, sort_order, status) VALUES (?, ?, ?, 'open')`,
      args: [milestoneId, it.label, it.sort_order]
    });
  }
}

// A fully-populated demo packing list that mirrors the real SB-1018 PDF, so the
// "replace the paper packing list" story is demoable on first run.
async function seedDemoPackingList(client, projectId) {
  const pl = await client.execute({
    sql: `INSERT INTO packing_lists
            (project_id, packing_no, customer_name, customer_address, invoice_no, invoice_date,
             package_type, dc_no, dc_date, vehicle_no, dispatch_through, contact_person, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [projectId, 'PL-1001', 'ASIAN BROWN BLEACHCHEM P LTD',
      '51, MITHABASPALLY, THANDUR-501141, VIKARABAD DIST, TELANGANA',
      'SB/0214/2025-26', '2026-01-03', 'BOILER — SB-BR-1018-SF-WB-120-10.54',
      '3773', '2026-01-03', 'TG12T3546', 'TRAILOR', '', 'draft', 'admin']
  });
  const id = Number(pl.lastInsertRowid);
  const items = [
    ['CONTROL PANEL', 'CS', 'AS PER DRAWING', 'SB-IBR-1018', 'SB-LOOSE 1', 1, ''],
    ['ID FAN WITH MOTOR', 'MS', 'CFM:3000 · 5 HP · HEAD 8" · 1440 RPM', 'SB-IBR-1018', 'SB-LOOSE 2', 1, '250921021822'],
    ['FD FAN WITH MOTOR', 'MS', 'CFM:2000 · 3 HP · HEAD 6" · 1440 RPM', 'SB-IBR-1018', 'SB-LOOSE 2', 1, ''],
    ['LADDER', 'MS', 'AS PER DRAWING', '', 'SB-LOOSE 3', 1, ''],
    ['FEED LINE PIPE', 'MS', 'AS PER DRAWING', 'SB-IBR-1018', 'SB-LOOSE 5', 1, ''],
    ['MS STRUCTURE WORK', 'STD', 'ISMC 75 x 5000 Lg · ISA 50x50x5 - 5000 Lg', '', 'SB-LOOSE 12,13,14', 3, ''],
  ];
  for (let i = 0; i < items.length; i++) {
    const [desc, moc, spec, ibr, box, qty, code] = items[i];
    await client.execute({
      sql: `INSERT INTO packing_items
              (packing_list_id, s_no, material_description, moc, size_spec, ibr_no, box_no, qty, unit, item_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, i + 1, desc, moc, spec, ibr, box, qty, "No's", code]
    });
  }
}

export async function initDB() {
  if (!initPromise) {
    const client = getClient();
    initPromise = migrate(client).then(() => client);
  }
  return initPromise;
}

export async function queryAll(sql, params = []) {
  const client = await initDB();
  const result = await client.execute({ sql, args: params });
  return result.rows;
}

export async function queryOne(sql, params = []) {
  const client = await initDB();
  const result = await client.execute({ sql, args: params });
  return result.rows.length ? result.rows[0] : null;
}

export async function execute(sql, params = []) {
  const client = await initDB();
  const result = await client.execute({ sql, args: params });
  return { changes: result.rowsAffected, lastId: result.lastInsertRowid };
}

// libsql has no atomic increment-and-return in one call across dialects we support, so do it as a
// short read-modify-write; fine at this write volume. Raw value, unformatted — nextNumber (below)
// is the "prefix-N" shaped wrapper most counters want; po_no formats itself instead (NNN/SB/YYYY-YY,
// not a plain prefix), which is why this exists as its own export.
export async function nextCounterValue(counterName, startAt = 1000) {
  const client = await initDB();
  const row = await queryOne('SELECT value FROM counters WHERE name = ?', [counterName]);
  const next = (row ? row.value : startAt) + 1;
  await client.execute({ sql: 'UPDATE counters SET value = ? WHERE name = ?', args: [next, counterName] });
  return next;
}

export async function nextNumber(counterName, prefix) {
  const next = await nextCounterValue(counterName);
  return `${prefix}-${next}`;
}
