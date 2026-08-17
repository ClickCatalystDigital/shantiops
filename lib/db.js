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
  await addColumn(client, 'users', 'department_roles TEXT');     // JSON: { Design: 'head'|'designer', Engineering: 'head'|'designer' }
  await addColumn(client, 'users', 'display_name TEXT');
  await addColumn(client, 'users', 'contact_number TEXT');
  await addColumn(client, 'users', 'active INTEGER NOT NULL DEFAULT 1');
  await addColumn(client, 'users', 'project_ids TEXT');          // CSV — a customer may own several projects
  await addColumn(client, 'users', 'pending INTEGER NOT NULL DEFAULT 0'); // self-registered, awaiting approval
  await addColumn(client, 'users', 'safe_pass INTEGER NOT NULL DEFAULT 0'); // admin-granted onboarding bypass — skips the device-enrollment gate (see needsDeviceEnrollment / hasSafePass)
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
  // V2-CHANGES.md D4 (Phase 5.0): Enquiry | Comparison | Ordered | Transit | Received | Cancelled
  // | In-Stock | null (null/unrecognized treated as Enquiry — see lib/bom-fields.mjs). Was
  // PENDING/TRANSIT/CLOSED/RECEIVED/CANCELLED; the backfill that converts existing rows lives
  // further down, once supplier_quotes/purchase_orders exist.
  await addColumn(client, 'bom_items', 'purchase_status TEXT');
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

  // Shop-floor roster + attendance now live on employees (employee_type='worker') + attendance_days
  // — see unifyWorkersIntoEmployees() below, which creates `workers`/`worker_days` only for the
  // one-time copy (if they don't already exist from an older DB) and drops both once done. Not
  // created here, so a DB that has already migrated never gets them resurrected as empty tables on
  // the next boot.

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
  // V2 master-data import (V2-CHANGES.md Group 3/D-columns) — the client's real STERP "Party
  // Master" export (vendor + customer files) carries this exact column set on both, so it's added
  // once here and mirrored on `customers` below. `address` above already covers "Address1";
  // address2/3 are the template's continuation lines.
  await addColumn(client, 'suppliers', 'party_code TEXT');
  await addColumn(client, 'suppliers', 'address2 TEXT');
  await addColumn(client, 'suppliers', 'address3 TEXT');
  await addColumn(client, 'suppliers', 'city TEXT');
  await addColumn(client, 'suppliers', 'state TEXT');
  await addColumn(client, 'suppliers', 'state_code TEXT');       // numeric GST state code (Telangana=36) — closes the IGST-vs-CGST/SGST gap (SYSTEM.md §5c)
  await addColumn(client, 'suppliers', 'country TEXT');
  await addColumn(client, 'suppliers', 'pin_code TEXT');
  await addColumn(client, 'suppliers', 'area TEXT');
  await addColumn(client, 'suppliers', 'fax TEXT');
  await addColumn(client, 'suppliers', 'website TEXT');
  await addColumn(client, 'suppliers', 'pan TEXT');
  await addColumn(client, 'suppliers', 'excise_range TEXT');
  await addColumn(client, 'suppliers', 'division TEXT');
  await addColumn(client, 'suppliers', 'gst_trans_type TEXT');   // Intrastate | Interstate | Export, as supplied — pre-computed per party in the source file
  await addColumn(client, 'suppliers', 'business_type TEXT');    // Private Limited Company | Sole Proprietorship | Partnership | LLP | ...
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
  // only materializes into one (purchase_status='Enquiry', D4, via bom_item_id here) once Procurement
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

  // V2-CHANGES.md Group 5 Phase 5.0 — data-model foundation for RFQ/Enquiry, PR bundles, and
  // In-Stock/SAS trading. Schema only here (no UI yet — that's 5.1+); the purchase_status enum
  // rename (D4) + its idempotent backfill sit right after, once these tables/columns exist.
  //
  // source (D7): which lifecycle this item is really on. 'bom' = normal project material
  // (default, project_id required, unchanged behavior). 'stock'/'sas' are Group 6 territory
  // (extra/frequently-used stock-building, or Sold-As-Such trade) — the column exists now so
  // Group 6 is additive, not a migration.
  await addColumn(client, 'bom_items', "source TEXT NOT NULL DEFAULT 'bom'");
  await addColumn(client, 'bom_items', 'sale_order_no TEXT'); // D14 — free text, 'sas' items only
  // D2 tri-state: NULL = undecided, 1 = the winning quote, 0 = a quote that lost out once a
  // sibling was picked. Never touched by anything except POST/DELETE .../select-supplier (Part F
  // of the Phase 5.0 plan) — append-only supplier_quotes stays append-only, this just marks
  // outcome without ever deleting/editing a logged quote.
  await addColumn(client, 'supplier_quotes', 'is_selected INTEGER');

  // D3 — PR as a first-class entity. purchase_requisitions is the header; pr_items are its line
  // items (bundled materials, not yet tied to any one bom_items row — a PR can be raised before
  // an RFQ or PO exists); pr_item_projects is the per-project qty split so one PR can serve
  // several boilers, reconciled back per project on award/receipt (Phase 5.2).
  await client.execute(`CREATE TABLE IF NOT EXISTS purchase_requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_no TEXT NOT NULL UNIQUE,
    raised_by_dept TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'bom',        -- bom | stock | sas, mirrors bom_items.source (D7)
    sale_order_no TEXT,                        -- D14, sas PRs only
    status TEXT NOT NULL DEFAULT 'open',       -- open | awarded | closed
    awarded_supplier_id INTEGER REFERENCES suppliers(id),
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS pr_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id INTEGER NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
    material_description TEXT NOT NULL,
    moc TEXT,
    size_spec TEXT,
    qty_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_pr_items_pr ON pr_items(pr_id)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS pr_item_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_item_id INTEGER NOT NULL REFERENCES pr_items(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id),
    qty_text TEXT
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_pr_item_projects_item ON pr_item_projects(pr_item_id)`);
  // Group 5 Bundle A (unified PR flow) — links a materialized bom_items row back to the PR line
  // (and, via it, the PR header) it came from, so Enquiry can show "PR-<n> · <when>". NULL for
  // every item that arrived some other way (PMB import, the old single-item request flow while it
  // was still live) — this is purely an origin tag, nothing downstream requires it.
  await addColumn(client, 'bom_items', 'pr_item_id INTEGER REFERENCES pr_items(id)');

  // RFQ entity (D1/D12/D13) — Request -> RFQ -> invite suppliers -> quotes via token link ->
  // compare -> award -> PO. rfq_items links an RFQ to either loose bom_items or pr_items (exactly
  // one of the two set per row, by construction of whichever flow created it) — one join table
  // instead of two, since an RFQ from a PR and an RFQ from loose items are the same entity from
  // here on. rfq_suppliers carries the no-login, 14-day supplier-portal token (D12); a re-send
  // issues a fresh token rather than reusing/extending the old one.
  await client.execute(`CREATE TABLE IF NOT EXISTS rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_no TEXT NOT NULL UNIQUE,
    pr_id INTEGER REFERENCES purchase_requisitions(id),   -- null = created from loose bom_items
    status TEXT NOT NULL DEFAULT 'draft',                 -- draft | sent | closed
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS rfq_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    token TEXT NOT NULL UNIQUE,
    token_expires INTEGER,           -- epoch ms, same convention as usb_requests.expires_at
    sent_at DATETIME,
    responded_at DATETIME
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_rfq ON rfq_suppliers(rfq_id)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS rfq_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    bom_item_id INTEGER REFERENCES bom_items(id),
    pr_item_id INTEGER REFERENCES pr_items(id)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items(rfq_id)`);

  // D8 — project-less inventory for Stores-owned stock (extra/frequently-used materials built up
  // via source='stock' items, and consumed by marking a bom_item In-Stock, D9). Built here so
  // Group 6 is purely additive on top; nothing reads/writes this table until then.
  await client.execute(`CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    spec TEXT,
    on_hand REAL NOT NULL DEFAULT 0,
    location TEXT,
    reorder_point REAL,
    item_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // D4 — purchase_status enum rename: PENDING/TRANSIT/CLOSED/RECEIVED/CANCELLED (old) becomes
  // Enquiry/Comparison/Ordered/Transit/Received/Cancelled/In-Stock (new, see lib/bom-fields.mjs).
  // One-off, idempotent backfill: guarded by a cheap existence check so a converted DB never pays
  // the six UPDATE scans again on every boot. Order matters — the PENDING/NULL split (by po_ref,
  // then by having a logged quote) must run after the direct 1:1 maps above it, and must use the
  // NEW status names as its own WHERE-target-exclusion is implicit (old tokens never reappear
  // once converted, so a second pass matches zero rows and is a natural no-op).
  const needsBackfill = await client.execute(
    `SELECT 1 FROM bom_items
      WHERE purchase_status IN ('PENDING','TRANSIT','CLOSED','RECEIVED','CANCELLED')
         OR purchase_status IS NULL LIMIT 1`);
  if (needsBackfill.rows.length) {
    await client.execute("UPDATE bom_items SET purchase_status = 'Transit' WHERE purchase_status = 'TRANSIT'");
    await client.execute("UPDATE bom_items SET purchase_status = 'Received' WHERE purchase_status IN ('CLOSED','RECEIVED')");
    await client.execute("UPDATE bom_items SET purchase_status = 'Cancelled' WHERE purchase_status = 'CANCELLED'");
    await client.execute(
      `UPDATE bom_items SET purchase_status = 'Ordered'
        WHERE (purchase_status = 'PENDING' OR purchase_status IS NULL) AND po_ref IS NOT NULL AND po_ref != ''`);
    await client.execute(
      `UPDATE bom_items SET purchase_status = 'Comparison'
        WHERE (purchase_status = 'PENDING' OR purchase_status IS NULL)
          AND EXISTS (SELECT 1 FROM supplier_quotes sq WHERE sq.bom_item_id = bom_items.id)`);
    await client.execute(
      "UPDATE bom_items SET purchase_status = 'Enquiry' WHERE purchase_status = 'PENDING' OR purchase_status IS NULL");
  }

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
  // V2-CHANGES.md Group 1 — the source PDF a certificate's fields were entered/AI-populated from,
  // stored in R2 (lib/r2.js). pdf_key is the R2 object key (always set once uploaded, used for
  // delete); pdf_url is the public URL if R2_PUBLIC_DOMAIN_URL is configured, else null (still
  // fetchable by key even without a public domain — not needed for V1's own preview, which proxies
  // through the app, but kept for a future direct-link case).
  await addColumn(client, 'test_certificates', 'pdf_key TEXT');
  await addColumn(client, 'test_certificates', 'pdf_url TEXT');
  // ponytail: `project_id` (a brief single-project phase) is vestigial — a cert belongs to MANY
  // projects (one plate is cut into parts across several boilers/orders), so the association lives in
  // certificate_projects below. Column left in place (all-NULL; SQLite column-drop is risky) — drop
  // in a later migration once nothing references it.
  await addColumn(client, 'test_certificates', 'project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
  // Many-to-many: which projects a certificate is used in. A cert may have zero (uploaded, not yet
  // allocated) and gain projects over time; a doc part links a cert only for a project it belongs to.
  await client.execute(`CREATE TABLE IF NOT EXISTS certificate_projects (
    certificate_id INTEGER NOT NULL REFERENCES test_certificates(id) ON DELETE CASCADE,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (certificate_id, project_id)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_certificate_projects_project ON certificate_projects(project_id)`);
  // A project belongs to one boiler-documentation series (lib/qc-series.js), set at creation and
  // encoded in its project number. Nullable: the pre-existing seed projects predate it (backfilled
  // by scripts/qc-reassign-certs.mjs).
  await addColumn(client, 'projects', 'series TEXT');

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
  // V2-CHANGES.md Group 2 — which company's letterhead/signatory prints on this document's PDF
  // (Shanti Boilers or Shanti Techno Fab, client point 1). Default reproduces the pre-existing
  // Shanti Boilers-only behavior for every row that predates this column.
  await addColumn(client, 'qc_documents', "company TEXT NOT NULL DEFAULT 'Shanti Boilers'");

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

  // Full-folder build (QC-FOLDER-DESIGN.md). Form III A needs two per-cert columns Form IV A doesn't.
  await addColumn(client, 'test_certificates', 'steel_making_process TEXT');
  await addColumn(client, 'test_certificates', 'heat_treatment TEXT');
  // Document-level fields the label / covering letter / Form II(1) need beyond the boiler meta above.
  // working_pressure is distinct from design_pressure/hydro (Form II(1) lists it separately).
  await addColumn(client, 'qc_documents', 'working_pressure TEXT');
  await addColumn(client, 'qc_documents', 'drawing_no_from TEXT');
  await addColumn(client, 'qc_documents', 'drawing_no_to TEXT');
  await addColumn(client, 'qc_documents', 'label_model_code TEXT');       // e.g. SBH-OF-WB-100-10.54 — manual for now
  await addColumn(client, 'qc_documents', 'submission_date TEXT');        // covering-letter date
  await addColumn(client, 'qc_documents', 'signer_name TEXT');            // QC engineer who signs
  await addColumn(client, 'qc_documents', 'recipient_name TEXT');         // null → Director of Boilers default
  await addColumn(client, 'qc_documents', 'recipient_address TEXT');
  await addColumn(client, 'qc_documents', 'manifest_extra TEXT');         // JSON: external supporting-doc lines for the covering letter

  // Mountings & fittings list — one row per fitting on this boiler (QC-FOLDER-DESIGN.md §4.2). Feeds
  // the mounting-list page and the covering letter's mounting/valve-TC counts. serial_numbers holds
  // the possibly-several physical serial numbers for one description (free text, newline/comma).
  await client.execute(`CREATE TABLE IF NOT EXISTS qc_mountings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES qc_documents(id) ON DELETE CASCADE,
    description TEXT,
    size TEXT,
    moc TEXT,
    serial_numbers TEXT,
    make TEXT,
    qty TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_qc_mountings_document ON qc_mountings(document_id)`);

  // V2 master-data import (V2-CHANGES.md Group 3/6) — a Sales-owned party record, mirroring
  // `suppliers`' column set exactly (both come from the same STERP "Party Master" export template).
  // Distinct from `users` (role=customer, portal logins) — this is a CRM/party record, not a login;
  // linking the two is a later increment, not needed for the master import itself.
  await client.execute(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    party_code TEXT,
    gst_no TEXT,
    pan TEXT,
    phone TEXT,
    fax TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    address2 TEXT,
    address3 TEXT,
    city TEXT,
    state TEXT,
    state_code TEXT,
    country TEXT,
    pin_code TEXT,
    area TEXT,
    excise_range TEXT,
    division TEXT,
    gst_trans_type TEXT,
    business_type TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // V2 master-data import — the client's real STERP Item Master (Purchase) catalog. Catalog only
  // (V2-CHANGES.md Group 3 decision, 2026-08-04): nothing else references this table yet —
  // `inventory_items`/`pr_items`/`bom_items` gain an optional item_code reference in a later round.
  // No UNIQUE on item_code or item_name: the real export leaves item_code blank on all but one of
  // 2,773 rows, and item_name has ~22 legitimate duplicate pairs (spec/size variants sharing a
  // label) — confirmed against the real file, not guessed.
  await client.execute(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    group_name TEXT,
    main_group TEXT,
    sub_group TEXT,
    group_code TEXT,
    item_code TEXT,
    item_name TEXT NOT NULL,
    detail_desc TEXT,
    drg_no TEXT,
    drg_rev TEXT,
    part_no TEXT,
    uom TEXT,
    cqty TEXT,
    cfactor TEXT,
    conv_uom TEXT,
    material_process_type TEXT,   -- Procured | Processed-in-House
    item_type TEXT,                -- Sales | Purchase | General
    min_qty TEXT,
    max_qty TEXT,
    lead_time TEXT,
    tolerance_plus TEXT,
    tolerance_minus TEXT,
    class TEXT,
    store_location TEXT,
    bin_no TEXT,
    hsn_code TEXT,
    hsn_desc TEXT,
    hsn_item_pct TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_items_name ON items(item_name)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code)`);

  // V2-CHANGES.md Group 6 Phase 6.1 — Sales department's simple Sale Order list (D14: free-text
  // so_no, upgrade to a real entity deferred). Referenced by bom_items.sale_order_no (source='sas'),
  // already added in Phase 5.0 — this table is just where Sales creates/lists the numbers.
  await client.execute(`CREATE TABLE IF NOT EXISTS sale_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_no TEXT NOT NULL,
    customer_name TEXT,
    description TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // V3_CHANGES.md A3 — the ERPNext integration seam. Today every row is source='demo', seeded
  // below. Track B's only job is to change WHO WRITES this table (a scheduled pull from ERPNext) —
  // the Executive 360 dashboard reads it exactly the same way either way, no UI change needed.
  // scope lets a metric be portfolio-wide ('ALL') or per-project (project_no) without a schema
  // change later. Invariant (V3_CHANGES.md §2.4): Shanti Ops never computes these values itself —
  // it only ever displays whatever this table holds.
  await client.execute(`CREATE TABLE IF NOT EXISTS erp_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_key TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'ALL',
    value_num REAL,
    value_text TEXT,
    source TEXT NOT NULL DEFAULT 'demo',      -- 'demo' | 'erpnext'
    as_of DATETIME NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(metric_key, scope)
  )`);

  // V3_CHANGES.md A4 — light Sales+Marketing pipeline over the existing `customers` party master.
  // Deliberately not a full CRM (no campaigns, no lead scoring) — just enough to make the
  // Executive 360 "Sales Pipeline" tile real. owner_dept lets Sales and Marketing share one board
  // while each still owns their own rows, same shared-surface idea as the cross-department Tickets
  // panel. customer_id is optional (a lead may predate a real customer record).
  await client.execute(`CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT,
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'Lead',       -- Lead | Qualified | Quoted | Won | Lost
    value_num REAL,
    probability INTEGER,
    expected_close DATE,
    owner_dept TEXT NOT NULL DEFAULT 'Sales', -- 'Sales' | 'Marketing'
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage)`);

  // ============================================================================================
  // V3_CHANGES.md §12 — CRM + Selling + HR built to real ERPNext feature depth, accounting
  // permanently excluded (product decision, do not reopen — see V3_CHANGES.md §12 for the full
  // boundary). Four phases: CRM, Selling, HR, Recruitment. Kept as one block since they land
  // together; each table still carries its own phase comment for future reference.
  // ============================================================================================

  // --- Phase 1: CRM --------------------------------------------------------------------------

  // Lead is a real entity (not just an Opportunity stage) — qualifies then converts to a
  // Customer + Opportunity pair via POST /api/leads/[id]/convert. converted_* stay null until
  // that happens; a lead is never deleted, only status-flipped, same append-only precedent as
  // supplier_quotes.
  await client.execute(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_name TEXT NOT NULL,
    company_name TEXT,
    phone TEXT,
    email TEXT,
    source TEXT,
    campaign_id INTEGER REFERENCES campaigns(id),
    status TEXT NOT NULL DEFAULT 'new',       -- new | contacted | qualified | converted | lost
    owner_dept TEXT NOT NULL DEFAULT 'Sales', -- Sales | Marketing
    notes TEXT,
    converted_customer_id INTEGER REFERENCES customers(id),
    converted_opportunity_id INTEGER REFERENCES opportunities(id),
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);

  // Marketing's own real surface — not just a pipeline co-tenant. leads.campaign_id and
  // opportunities.campaign_id (added below) both reference this.
  await client.execute(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    campaign_type TEXT,
    start_date DATE,
    end_date DATE,
    status TEXT NOT NULL DEFAULT 'planned', -- planned | active | completed
    budget REAL,
    owner_dept TEXT NOT NULL DEFAULT 'Marketing',
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumn(client, 'opportunities', 'campaign_id INTEGER REFERENCES campaigns(id)');

  // ERPNext CRM parity fields (docs.frappe.io/erpnext/CRM) — Source/Lost Reason/Next Contact
  // Date on Opportunity, Territory/Industry on Lead. Plain nullable columns, same addColumn
  // pattern as campaign_id above — no migration needed for existing rows.
  await addColumn(client, 'opportunities', 'source TEXT');
  await addColumn(client, 'opportunities', 'lost_reason TEXT');
  await addColumn(client, 'opportunities', 'next_contact_date DATE');
  await addColumn(client, 'leads', 'territory TEXT');
  await addColumn(client, 'leads', 'industry TEXT');
  await addColumn(client, 'leads', 'next_contact_date DATE');

  // Frappe CRM parity (github.com/frappe/crm) — Task, Call Log, saved Views, Assignment Rule.
  // Task reuses the existing cross-department `tasks` table (already "every department's own
  // ad-hoc board", see its own header comment above) instead of a new crm_tasks table — a CRM
  // task is just a task whose lead_id/opportunity_id/customer_id is set, same discriminator
  // crm_notes already uses for its three link columns (exactly one set = which record it's on).
  await addColumn(client, 'tasks', 'lead_id INTEGER REFERENCES leads(id)');
  await addColumn(client, 'tasks', 'opportunity_id INTEGER REFERENCES opportunities(id)');
  await addColumn(client, 'tasks', 'customer_id INTEGER REFERENCES customers(id)');
  // Call Log — Frappe CRM's Call Log is its own doctype (duration, direction); here it's the
  // same crm_notes row a call already used (note_type='call') with two more nullable columns,
  // populated only when logging a call, same "reuse the existing table" call as Task above.
  await addColumn(client, 'crm_notes', 'call_type TEXT'); // incoming | outgoing
  await addColumn(client, 'crm_notes', 'duration_seconds INTEGER');
  // Assignment Rule — round-robin a department's new leads across a configured list of
  // usernames (plain TEXT, no FK to users — same no-FK convention as tasks.assigned_to and
  // milestones.assignee). One row per department; next_index advances on every auto-assign.
  await client.execute(`CREATE TABLE IF NOT EXISTS crm_assignment_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_dept TEXT NOT NULL UNIQUE,     -- Sales | Marketing
    usernames TEXT NOT NULL DEFAULT '[]', -- JSON array of usernames, round-robin order
    next_index INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumn(client, 'leads', 'assigned_to TEXT');
  // Saved/Pinned Views (Frappe CRM's "Saved View"/"Pinned View") — a named, reusable filter set
  // for a list, scoped to the user who saved it. `entity` leaves room for more than 'leads'
  // later without a schema change.
  await client.execute(`CREATE TABLE IF NOT EXISTS crm_saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT 'leads',
    name TEXT NOT NULL,
    filters TEXT NOT NULL DEFAULT '{}', -- JSON
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_crm_saved_views_user ON crm_saved_views(user, entity)`);

  // Scope of Supply / Work Order — the confirmed order's handoff to Design + Engineering,
  // replacing the inert placeholder DesignPanel.jsx has carried since CALC-CHANGES2.md §D
  // ("awaiting Work Order / Scope of Supply format"). Deliberately a free-text `spec` field, not
  // a structured boiler-configuration schema — the real format hasn't been provided yet, this is
  // an educated draft to unblock the handoff, meant to be replaced once Shanti gives the actual
  // format. One row per project (shared by Design and Engineering, not department-split — it's
  // the same work order both read from).
  await client.execute(`CREATE TABLE IF NOT EXISTS scope_of_supply (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    spec TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | released
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_scope_of_supply_project ON scope_of_supply(project_id)`);

  // Opportunities get real line items instead of one lump value_num (value_num stays as a
  // manual override/estimate before items exist, same "estimate then itemize" precedent bom_items
  // already has with qty_text vs the later structured quantity).
  await client.execute(`CREATE TABLE IF NOT EXISTS opportunity_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    qty REAL,
    uom TEXT,
    rate REAL,
    amount REAL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  // Shared activity/notes timeline across lead/opportunity/customer — exactly one of the three
  // FKs set per row, same nullable-multi-FK shape `notifications` already uses for
  // milestone_id/task_id (resolved via COALESCE there); not a new abstraction, the same one reused.
  await client.execute(`CREATE TABLE IF NOT EXISTS crm_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    note_type TEXT NOT NULL DEFAULT 'note', -- call | email | meeting | note
    content TEXT NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_crm_notes_lead ON crm_notes(lead_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_crm_notes_opp ON crm_notes(opportunity_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_crm_notes_cust ON crm_notes(customer_id)`);

  // DB-configurable pipeline stages, same precedent as stage_templates (§3c) — a PM adds/reorders
  // a stage with no code change. opportunities.stage stays a plain TEXT column validated against
  // this table's names (not an FK id), same idiom bom_items.purchase_status already uses against
  // PURCHASE_STATUSES — avoids cascading rename issues on a rename.
  await client.execute(`CREATE TABLE IF NOT EXISTS sales_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_won INTEGER NOT NULL DEFAULT 0,
    is_lost INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  const stageSeed = [
    ['Lead', 0, 0, 0], ['Qualified', 1, 0, 0], ['Quoted', 2, 0, 0],
    ['Won', 3, 1, 0], ['Lost', 4, 0, 1],
  ];
  const hasStages = await client.execute('SELECT 1 FROM sales_stages LIMIT 1');
  if (!hasStages.rows.length) {
    for (const [name, sort_order, is_won, is_lost] of stageSeed) {
      await client.execute({
        sql: 'INSERT INTO sales_stages (name, sort_order, is_won, is_lost) VALUES (?, ?, ?, ?)',
        args: [name, sort_order, is_won, is_lost],
      });
    }
  }

  // --- Phase 2: Selling ------------------------------------------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    designation TEXT,
    phone TEXT,
    email TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Separate from customers' own inline address (suppliers keep theirs inline too — 445 live
  // rows, no migration reason). Customers need multiple ship-to addresses for trading; suppliers
  // don't, so only customers gets this table. state_code kept deliberately for a future tax layer
  // (HARD BOUNDARY: never a calculation input here, just stored reference data).
  await client.execute(`CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    address_type TEXT NOT NULL DEFAULT 'Billing', -- Billing | Shipping | Office
    line1 TEXT, line2 TEXT, line3 TEXT,
    city TEXT, state TEXT, state_code TEXT, country TEXT, pin_code TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Customer-facing Quotation — the selling backbone quotation-pdf mirrors lib/po-pdf.js exactly.
  // subtotal/tax_pct/tax_amount/total are simple line-sum + one flat percentage for display/PDF
  // only (HARD BOUNDARY — same precedent lib/po-pdf.js already sets: "GST @ X%", never IGST vs
  // CGST/SGST, never a ledger entry).
  await client.execute(`CREATE TABLE IF NOT EXISTS quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_no TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    opportunity_id INTEGER REFERENCES opportunities(id),
    quotation_date DATE,
    valid_until DATE,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | sent | accepted | rejected | expired
    subtotal REAL NOT NULL DEFAULT 0,
    tax_pct REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    terms TEXT,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS quotation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    hsn_code TEXT, -- stored reference string only, never a tax-rate lookup (HARD BOUNDARY)
    qty REAL, uom TEXT, rate REAL, amount REAL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  // Sale Orders gain the same commercial shape as Quotations, plus the links that complete the
  // Lead → Customer+Opportunity → Quotation → Sale Order → Project chain. so_no stays free text —
  // bom_items.sale_order_no is a free-text copy of it today and is NOT converted to an FK here.
  await client.execute(`CREATE TABLE IF NOT EXISTS sale_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_order_id INTEGER NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    hsn_code TEXT,
    qty REAL, uom TEXT, rate REAL, amount REAL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await addColumn(client, 'sale_orders', 'customer_id INTEGER REFERENCES customers(id)');
  await addColumn(client, 'sale_orders', 'opportunity_id INTEGER REFERENCES opportunities(id)');
  await addColumn(client, 'sale_orders', 'quotation_id INTEGER REFERENCES quotations(id)');
  await addColumn(client, 'sale_orders', "status TEXT NOT NULL DEFAULT 'open'"); // open | fulfilled | cancelled
  await addColumn(client, 'sale_orders', 'subtotal REAL NOT NULL DEFAULT 0');
  await addColumn(client, 'sale_orders', 'tax_pct REAL NOT NULL DEFAULT 0');
  await addColumn(client, 'sale_orders', 'tax_amount REAL NOT NULL DEFAULT 0');
  await addColumn(client, 'sale_orders', 'total REAL NOT NULL DEFAULT 0');

  // projects.customer_name stays NOT NULL (unchanged column) — customer_id is additive and
  // nullable so the 6 live projects (free-text customer_name only) keep working unmodified.
  await addColumn(client, 'projects', 'customer_id INTEGER REFERENCES customers(id)');
  await addColumn(client, 'projects', 'sale_order_id INTEGER REFERENCES sale_orders(id)');

  // --- Phase 3: HR -----------------------------------------------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS designations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS employment_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
  )`);
  const empTypeSeed = ['Full-time', 'Part-time', 'Contract', 'Intern'];
  const hasEmpTypes = await client.execute('SELECT 1 FROM employment_types LIMIT 1');
  if (!hasEmpTypes.rows.length) {
    for (const name of empTypeSeed) {
      await client.execute({ sql: 'INSERT INTO employment_types (name) VALUES (?)', args: [name] });
    }
  }

  // Shop-floor skill, Production-owned — distinct from designation (HR job title/pay grade above).
  // A job card assigns work by trade ("need a welder"), never by designation. employees.trade
  // stays free TEXT (matches the pre-existing workers.trade shape); this is the controlled list a
  // picker validates against, same relationship shift_types has to shift_assignments.
  await client.execute(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
  )`);
  const tradeSeed = ['Welder', 'Fitter', 'Gas Cutter', 'Machinist', 'Grinder', 'Painter', 'Rigger', 'Helper'];
  const hasTrades = await client.execute('SELECT 1 FROM trades LIMIT 1');
  if (!hasTrades.rows.length) {
    for (const name of tradeSeed) {
      await client.execute({ sql: 'INSERT INTO trades (name) VALUES (?)', args: [name] });
    }
  }

  // The single people master (V3_CHANGES.md §12 decision 1) — absorbs the old Production-only
  // `workers` table. employee_type='worker' is a label, not a separate table; `department` is
  // deliberately the EXISTING ops DEPARTMENTS taxonomy (lib/milestones.js), not a second
  // HR-department table — an employee's department genuinely is the ops taxonomy, no conflict
  // with the "ops depts != HR/accounting depts, don't sync" rule (that rule is about NOT
  // building a second, separately-synced taxonomy — this isn't one).
  await client.execute(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    employee_type TEXT NOT NULL DEFAULT 'staff', -- staff | worker
    designation_id INTEGER REFERENCES designations(id),
    employment_type_id INTEGER REFERENCES employment_types(id),
    department TEXT,
    trade TEXT,
    user_id INTEGER REFERENCES users(id),
    date_of_joining DATE,
    date_of_exit DATE,
    phone TEXT,
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumn(client, 'employees', 'access_departments TEXT'); // CSV mirror of system department access; HR department remains primary
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_employees_type ON employees(employee_type)`);

  // One attendance system (decision 8) — employee-keyed, replacing worker_days. Same
  // present|half|absent + INSERT...ON CONFLICT upsert shape the old worker-days route already
  // proved; 'leave' added as a 4th status so an approved leave_request can stamp the day directly.
  await client.execute(`CREATE TABLE IF NOT EXISTS attendance_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'present', -- present | half | absent | leave
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_days_date ON attendance_days(date)`);

  // Leave — full depth (annual_entitlement/allocations/balance). Balance is ALWAYS computed
  // (lib/hr.js), never stored as a running counter — the exact denormalized-drift failure mode
  // documented at the end of SYSTEM.md (purchase_status found stale independently three times).
  await client.execute(`CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    annual_entitlement REAL NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  const leaveTypeSeed = [
    ['Casual Leave', 12, 1], ['Sick Leave', 12, 1], ['Earned Leave', 15, 1], ['Unpaid Leave', 0, 0],
  ];
  const hasLeaveTypes = await client.execute('SELECT 1 FROM leave_types LIMIT 1');
  if (!hasLeaveTypes.rows.length) {
    for (const [name, ent, paid] of leaveTypeSeed) {
      await client.execute({
        sql: 'INSERT INTO leave_types (name, annual_entitlement, is_paid) VALUES (?, ?, ?)',
        args: [name, ent, paid],
      });
    }
  }
  await client.execute(`CREATE TABLE IF NOT EXISTS leave_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
    year INTEGER NOT NULL,
    allocated REAL NOT NULL DEFAULT 0,
    UNIQUE(employee_id, leave_type_id, year)
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days REAL NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
    decided_by TEXT,
    decided_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date DATE NOT NULL UNIQUE,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Shifts — directly relevant to a factory floor.
  await client.execute(`CREATE TABLE IF NOT EXISTS shift_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    start_time TEXT, end_time TEXT,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS shift_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
    from_date DATE NOT NULL,
    to_date DATE, -- NULL = ongoing
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Onboarding / Separation — header + child-checklist, mirroring the qc_documents +
  // qc_document_parts shape (SYSTEM.md §5d) already proven in this codebase for "a record with a
  // bulk-actionable checklist of parts."
  await client.execute(`CREATE TABLE IF NOT EXISTS employee_onboarding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS onboarding_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    onboarding_id INTEGER NOT NULL REFERENCES employee_onboarding(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | done
    assigned_to TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS employee_separation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS separation_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    separation_id INTEGER NOT NULL REFERENCES employee_separation(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | done
    assigned_to TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  // V3_CHANGES.md §13 — HR field-depth gap closure. A field-by-field audit against the real
  // Employee/Attendance/Leave Application doctypes found real gaps left out of §12 on priority
  // judgment alone, not by request. bank_ifsc substituted for Frappe's `iban` (IFSC is the
  // correct Indian bank-routing field). Salary/bank fields are reference data only, never a
  // calculation input — same `quotations.tax_pct` stored-value precedent, HARD BOUNDARY unaffected.
  await addColumn(client, 'employees', 'gender TEXT');
  await addColumn(client, 'employees', 'date_of_birth DATE');
  await addColumn(client, 'employees', 'photo_url TEXT');
  await addColumn(client, 'employees', 'reports_to INTEGER REFERENCES employees(id)'); // manager/org chart; default leave approver
  await addColumn(client, 'employees', 'current_address TEXT');
  await addColumn(client, 'employees', 'permanent_address TEXT');
  await addColumn(client, 'employees', 'emergency_contact_name TEXT');
  await addColumn(client, 'employees', 'emergency_contact_phone TEXT');
  await addColumn(client, 'employees', 'emergency_contact_relation TEXT');
  await addColumn(client, 'employees', 'personal_email TEXT'); // existing `email` column is the company email
  await addColumn(client, 'employees', 'scheduled_confirmation_date DATE');
  await addColumn(client, 'employees', 'final_confirmation_date DATE');
  await addColumn(client, 'employees', 'contract_end_date DATE');
  await addColumn(client, 'employees', 'notice_period_days INTEGER');
  await addColumn(client, 'employees', 'date_of_retirement DATE');
  await addColumn(client, 'employees', 'salary_mode TEXT');
  await addColumn(client, 'employees', 'bank_name TEXT');
  await addColumn(client, 'employees', 'bank_account_no TEXT');
  await addColumn(client, 'employees', 'bank_ifsc TEXT');
  await addColumn(client, 'employees', 'ctc REAL'); // annual CTC, stored only, never a calculation input
  await addColumn(client, 'employees', "salary_currency TEXT NOT NULL DEFAULT 'INR'");

  // Exit fields extend employee_separation (§12 already gave exit its own table) rather than
  // duplicating exit state on employees.
  await addColumn(client, 'employee_separation', 'resignation_letter_date DATE');
  await addColumn(client, 'employee_separation', 'relieving_date DATE');
  await addColumn(client, 'employee_separation', 'reason_for_leaving TEXT');
  await addColumn(client, 'employee_separation', 'leave_encashed INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'employee_separation', 'encashment_amount REAL'); // Frappe only has a date; the amount is the useful number
  await addColumn(client, 'employee_separation', 'exit_interview_held_on DATE');
  await addColumn(client, 'employee_separation', 'exit_interview_feedback TEXT');
  await addColumn(client, 'employee_separation', 'new_workplace TEXT');

  // Punch times — optional; working_hours/late_entry/early_exit are derived at write time
  // (app/api/attendance/route.js, lib/hr.js deriveAttendanceMetrics) against the employee's shift
  // for that date, when one exists. leave_request_id closes the gap where an approved leave
  // stamps a 'leave' day with no link back to the request that caused it.
  await addColumn(client, 'attendance_days', 'in_time TEXT');
  await addColumn(client, 'attendance_days', 'out_time TEXT');
  await addColumn(client, 'attendance_days', 'working_hours REAL');
  await addColumn(client, 'attendance_days', 'late_entry INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'attendance_days', 'early_exit INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'attendance_days', 'leave_request_id INTEGER REFERENCES leave_requests(id)');

  await addColumn(client, 'leave_requests', 'half_day INTEGER NOT NULL DEFAULT 0');
  await addColumn(client, 'leave_requests', 'half_day_date DATE');
  await addColumn(client, 'leave_requests', 'approver_id INTEGER REFERENCES employees(id)'); // defaults from reports_to, overridable; distinct from decided_by
  await addColumn(client, 'leave_requests', 'balance_at_application REAL'); // snapshot at request time, never rewritten by a later allocation change

  // --- Phase 4: Recruitment (ATS) --------------------------------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS job_openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    department TEXT,
    employment_type_id INTEGER REFERENCES employment_types(id),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open', -- open | on_hold | closed
    opened_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS job_applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_opening_id INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT, phone TEXT, resume_url TEXT,
    status TEXT NOT NULL DEFAULT 'applied', -- applied|screening|interview|offered|hired|rejected
    source TEXT, notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_applicants_status ON job_applicants(status)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id INTEGER NOT NULL REFERENCES job_applicants(id) ON DELETE CASCADE,
    scheduled_at DATETIME,
    interviewer TEXT,
    feedback TEXT,
    rating INTEGER,
    status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | completed | cancelled
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // offer_note is a free-text reference only, never a payroll figure — HARD BOUNDARY.
  await client.execute(`CREATE TABLE IF NOT EXISTS job_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id INTEGER NOT NULL REFERENCES job_applicants(id) ON DELETE CASCADE,
    designation_id INTEGER REFERENCES designations(id),
    offer_note TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | sent | accepted | declined
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Phase 6.3 — reserved/available inventory model. on_hand (inventory_items) stays the physical
  // count; a reservation reduces `available` without touching on_hand until Stores actually Issues
  // it (bom_item -> In-Stock, on_hand decremented then). Exclusive by construction: two requests
  // can never both draw the same units, since `available` always nets out every active reservation.
  await client.execute(`CREATE TABLE IF NOT EXISTS inventory_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    bom_item_id INTEGER NOT NULL REFERENCES bom_items(id),
    qty REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | released | issued
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME,
    issued_at DATETIME
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_inv_reservations_item ON inventory_reservations(inventory_item_id, status)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_inv_reservations_bom_item ON inventory_reservations(bom_item_id)`);

  // Links an issued reservation (or a stock-build item) to the inventory row it moved. Optional —
  // only ever set once a reservation is issued or a source='stock' item is materialized against a
  // named inventory line.
  await addColumn(client, 'bom_items', 'inventory_item_id INTEGER REFERENCES inventory_items(id)');
  // Numeric qty captured at request/reserve time — qty_text stays free text ("4 Nos") and is never
  // parsed for arithmetic; this is the authoritative number inventory math reads (D9 decrement,
  // D7 stock-build increment).
  await addColumn(client, 'bom_items', 'inventory_qty REAL');

  // Phase 6.4 — bom_items.project_id is NOT NULL at the DB level (see the CREATE TABLE above) and
  // this codebase never ALTERs an existing column, so source='stock'/'sas' items (which have no
  // real project, D7) point at one seeded sentinel "system" project instead of a null project_id.
  // is_system marks it so every project-listing query can exclude it explicitly; status='system'
  // (not 'active') already hides it from every dashboard/rollup query, which all filter
  // WHERE status='active' — confirmed by grep across lib/data.js.
  await addColumn(client, 'projects', 'is_system INTEGER NOT NULL DEFAULT 0');
  const sentinel = await client.execute("SELECT id FROM projects WHERE is_system = 1 LIMIT 1");
  if (!sentinel.rows.length) {
    await client.execute(
      `INSERT INTO projects (project_no, customer_name, description, status, is_system)
       VALUES ('—NON-PROJECT—', 'N/A', 'Sentinel project for source=stock/sas bom_items (Group 6)', 'system', 1)`
    );
  }

  // Calc module — engineering calculation engine (variables/formulas/validations/snapshots).
  // See SYSTEM.md §5f for the module overview and what's deferred. `dimension` is unused today —
  // a leftover reserved column from before the unit system landed inline on `unit`. formula_id has
  // no FK enforcement (this app never turns PRAGMA
  // foreign_keys on) so table creation order here doesn't matter.
  //
  // CALC-CHANGES2.md §A — Calc Sheets' real project hierarchy: Company -> Project -> Calc Sheet ->
  // Run/Snapshot. calc_sheets is the new grouping layer under a real `projects` row; Registry
  // (calc_variables), snapshots, and notes become per-sheet (see migrateCalcProjectHierarchy below).
  // Methodology/Library/Tables/Validations/Templates stay fully global on purpose — shared
  // engineering knowledge referenced by name from any sheet, not scoped to one project.
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_sheets_project ON calc_sheets(project_id)`);

  await client.execute(`CREATE TABLE IF NOT EXISTS calc_variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'input', -- input | constant | computed | array
    unit TEXT,
    dimension TEXT,
    value REAL,
    formula_id INTEGER,
    -- Phase 3, item 14 (array/list variables) — a list of records (tube bundle, nozzle schedule)
    -- for type='array' only; e.g. [{"Name":"N1","Diameter":50,"Area":19.6}, ...]. Kept as JSON on
    -- the variable itself (not a separate table like calc_tables) since it's read/written whole and
    -- doesn't need calc_tables' interpolation/lookup machinery.
    array_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // output_var UNIQUE: a variable is computed by exactly one formula, and the uniqueness also
  // closes a check-then-insert race in seedCalcDemoData's upsertFormula (two concurrent first
  // requests could otherwise both pass the "does this output_var exist" check before either
  // commits — INSERT OR IGNORE below relies on this constraint to make that safe).
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_formulas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    output_var TEXT NOT NULL UNIQUE,
    unit TEXT,
    cur_v INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | pending | approved | deprecated
    source_standard TEXT,
    source_clause TEXT,
    source_url TEXT,
    -- Phase 3, item 15 (structured standard-clause tracker) — edition/year as its own field instead
    -- of folded into source_clause free text, so a report can index "which edition was this
    -- calculated against" without parsing a string.
    source_edition TEXT,
    -- Phase 1.2 (iteration/convergence) — only meaningful when computeAll's cycle detection finds
    -- this formula in a circular dependency group; ignored otherwise. Relative tolerance, damping
    -- 0.5-1.0 dampens oscillation (1 = no damping), same knobs Kimi's brief calls for.
    iteration_tolerance REAL NOT NULL DEFAULT 0.001,
    iteration_max INTEGER NOT NULL DEFAULT 50,
    iteration_damping REAL NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Idempotent adds for a calc_formulas table created before Phase 1.2 (CREATE TABLE IF NOT
  // EXISTS above doesn't retrofit columns onto an existing table) — same addColumn() idiom used
  // elsewhere in this migrate().
  await addColumn(client, 'calc_formulas', 'iteration_tolerance REAL NOT NULL DEFAULT 0.001');
  await addColumn(client, 'calc_formulas', 'iteration_max INTEGER NOT NULL DEFAULT 50');
  await addColumn(client, 'calc_formulas', 'iteration_damping REAL NOT NULL DEFAULT 1');
  await addColumn(client, 'calc_formulas', 'source_edition TEXT');
  await addColumn(client, 'calc_variables', 'array_json TEXT');

  await client.execute(`CREATE TABLE IF NOT EXISTS calc_formula_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formula_id INTEGER NOT NULL REFERENCES calc_formulas(id),
    v INTEGER NOT NULL,
    expr TEXT NOT NULL,
    note TEXT,
    -- Phase 2.4 (conditional formula execution) — optional boolean expression; a false guard skips
    -- this formula for the run instead of computing it. Only read for acyclic formulas (see
    -- computeAll's comment in lib/calc-engine.js) and only against input/constant values.
    guard_expr TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_formula_versions_formula ON calc_formula_versions(formula_id)`);
  await addColumn(client, 'calc_formula_versions', 'guard_expr TEXT');
  // Belt-and-suspenders for a DB created before output_var was UNIQUE above (CREATE TABLE IF NOT
  // EXISTS doesn't retrofit the constraint onto an existing table): drop any output_var duplicate
  // that never got a version row (the race's telltale orphan — see the comment above), then add the
  // uniqueness as an index so it's enforced either way.
  await client.execute(`DELETE FROM calc_formulas WHERE id IN (
    SELECT f.id FROM calc_formulas f
    WHERE NOT EXISTS (SELECT 1 FROM calc_formula_versions v WHERE v.formula_id = f.id)
      AND EXISTS (SELECT 1 FROM calc_formulas f2 WHERE f2.output_var = f.output_var AND f2.id != f.id)
  )`);
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_calc_formulas_output_var ON calc_formulas(output_var)`);

  await client.execute(`CREATE TABLE IF NOT EXISTS calc_validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    expr TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning', -- fail | warning
    message TEXT
  )`);

  await client.execute(`CREATE TABLE IF NOT EXISTS calc_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP,
    input_override TEXT NOT NULL, -- JSON: { [varName]: value }
    formula_version_override TEXT NOT NULL, -- JSON: { [formulaId]: v }
    results TEXT NOT NULL, -- JSON: { [varName]: value }
    created_by TEXT
  )`);

  // Phase 1.3 (lookup tables + interpolation) — a table's Y columns and rows are stored as JSON
  // (same idiom as calc_snapshots' JSON blobs above) rather than a normalized column/cell schema:
  // this data is small, always read/written whole, and a material table's column set is fixed once
  // authored — normalizing it would add tables without adding real query flexibility.
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, -- referenced by formulas as LOOKUP("name", x, "column")
    standard TEXT,
    x_column TEXT NOT NULL, -- e.g. "Temperature"
    x_unit TEXT,
    columns TEXT NOT NULL, -- JSON: [{ name, unit }, ...] — the Y columns available to LOOKUP
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_table_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES calc_tables(id),
    x_value REAL NOT NULL,
    values_json TEXT NOT NULL, -- JSON: { [columnName]: number }
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_table_rows_table ON calc_table_rows(table_id)`);

  // Phase 1.4 (regression test harness) — a test case pins a set of input values and the output
  // that formula must produce from them, within tolerance. Run on save (see app/api/calc-formulas/
  // [id]/route.js) and blocks Draft->Pending submission on failure, so a formula can't be sent for
  // approval while it's known to contradict its own worked examples.
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_formula_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formula_id INTEGER NOT NULL REFERENCES calc_formulas(id),
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL, -- JSON: { [varName]: value } — fed to computeAll as inputOverride
    expected_output REAL NOT NULL,
    tolerance REAL NOT NULL DEFAULT 0.01,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_formula_tests_formula ON calc_formula_tests(formula_id)`);

  // Phase 3, item 13 (engineering notes/commentary) — free-text commentary attachable to any
  // variable or formula, own audit trail (append-only in the UI — no edit, matches how the rest of
  // this module treats history: new version/snapshot, never a silent rewrite).
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, -- variable | formula
    entity_id INTEGER NOT NULL,
    author TEXT,
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_notes_entity ON calc_notes(entity_type, entity_id)`);

  // Phase 3, item 16 (calculation templates) — a named preset of input/constant values ("Fire Tube
  // Boiler — Standard") that resets the registry to a canonical starting scenario. JSON blob, same
  // idiom as calc_snapshots/calc_tables — small, read/written whole.
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    values_json TEXT NOT NULL, -- JSON: { [varName]: value }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // CALC-CHANGES2.md §B — Drawings panel: a checklist + file-upload space for design deliverables,
  // project-scoped (not sheet-scoped — a GA Drawing represents the whole boiler, not one calc
  // sheet). Files go to Cloudflare R2 (lib/r2.js), same pattern as test_certificates.pdf_key — the
  // key is stored here, not a local path (Render's filesystem is ephemeral).
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    drawing_type TEXT,
    status TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | under_review | approved | as_built
    assigned_to TEXT,
    due_date TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_drawings_project ON calc_drawings(project_id)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_drawing_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id INTEGER NOT NULL REFERENCES calc_drawings(id),
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_key TEXT NOT NULL, -- R2 object key, e.g. calc-drawings/{drawingId}/{ts}-{fileName}
    file_url TEXT,
    uploaded_by TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_drawing_files_drawing ON calc_drawing_files(drawing_id)`);

  // Customer drawing approval — a customer's sign-off is a separate fact from Design's own
  // `status` ladder above (approved-by-Design and approved-by-customer aren't the same event), so
  // it's two columns layered on top rather than folded into `status`.
  await addColumn(client, 'calc_drawings', 'customer_approved_at DATETIME');
  await addColumn(client, 'calc_drawings', 'customer_approved_by TEXT');
  // Design decides which drawings are customer-facing at all, independent of status — a project
  // can have drawings the customer never needs to see (internal detail sheets), not just GA/
  // Foundation. Defaults off: a drawing only reaches the portal once Design opts it in.
  await addColumn(client, 'calc_drawings', 'customer_visible INTEGER NOT NULL DEFAULT 0');
  // customer_visible_since is set only on a real 0->1 flip (not every PATCH) and cleared back to
  // NULL on 1->0 — a debounced "notify the customer" sweep (lib/calc.js sweepDrawingNotifications,
  // called opportunistically from getNotifications, not a real cron — see its own comment for why)
  // fires once this has sat true for 5+ minutes, so an accidental toggle-and-revert never pages
  // anyone. customer_notified_at marks that the debounced notification already fired, so the sweep
  // never double-sends.
  await addColumn(client, 'calc_drawings', 'customer_visible_since DATETIME');
  await addColumn(client, 'calc_drawings', 'customer_notified_at DATETIME');
  await client.execute(`CREATE TABLE IF NOT EXISTS calc_drawing_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id INTEGER NOT NULL REFERENCES calc_drawings(id),
    author_type TEXT NOT NULL, -- customer | internal
    author_name TEXT NOT NULL,
    author_username TEXT,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_calc_drawing_comments_drawing ON calc_drawing_comments(drawing_id)`);

  // CALC-CHANGES2.md §F — Requests tab (the live one is /pr's unified PR flow, `purchase_
  // requisitions`/`pr_items`; the older `procurement_requests` single-item table above is already
  // dead per Nav.jsx's "old /requests tab ... is retired" comment, so category tagging extends the
  // live mechanism, not the dead one). `category_fields_json` is the same "small, shape varies,
  // read/written whole" idiom calc_tables/calc_snapshots already use, rather than a wide sparse
  // column set for plate vs. MS-section vs. angle vs. standard-item fields.
  await addColumn(client, 'pr_items', 'category TEXT'); // plate | ms_section | angle | standard
  await addColumn(client, 'pr_items', 'category_fields_json TEXT');
  // origin (D7-style future hook) — 'manual' (typed today, the only value produced this round) |
  // 'bom' (reserved for a future auto-BOM generator, not built this round). Deliberately not named
  // `source` — that already means bom/stock/sas on bom_items (D7) and reusing the name here would
  // collide with a different axis of meaning on the same row.
  await addColumn(client, 'pr_items', "origin TEXT NOT NULL DEFAULT 'manual'");
  await addColumn(client, 'bom_items', 'category TEXT');
  await addColumn(client, 'bom_items', 'category_fields_json TEXT');
  await addColumn(client, 'bom_items', "origin TEXT NOT NULL DEFAULT 'manual'");

  // ================================================================================================
  // HR completion bundle — Payroll (statutory) + Expense Claims/Advances/Loans + Full & Final
  // settlement. V3_CHANGES.md §12's "HARD BOUNDARY" around accounting/payroll math was intentionally
  // reopened by explicit user decision: a future accounting sync (e.g. a Tally agent) will read the
  // numbers computed here and post them into real accounting software — Shanti Ops computes and
  // stores the statutory figures as plain facts (same precedent quotations.total/employees.ctc
  // already set) and never builds a ledger/chart of accounts/journal entries itself. Every column a
  // future sync will need is marked ACCOUNTING INTEGRATION POINT.
  // ================================================================================================

  // --- Payroll: salary structure ------------------------------------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS salary_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // No separate salary_components master catalog — at this company's scale (a handful of salaried
  // staff, 1-3 structures) a shared reusable-component catalog buys nothing a plain per-structure
  // name doesn't. "Basic" is never a row here — it's salary_structure_assignments.base directly;
  // HRA/conveyance/etc. are flat amounts or a percent of that base.
  await client.execute(`CREATE TABLE IF NOT EXISTS salary_structure_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salary_structure_id INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    component_type TEXT NOT NULL,           -- earning | deduction
    calc_type TEXT NOT NULL DEFAULT 'flat', -- flat | percent_of_basic
    amount REAL,
    percent REAL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS salary_structure_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    salary_structure_id INTEGER NOT NULL REFERENCES salary_structures(id),
    base REAL NOT NULL, -- monthly Basic
    from_date DATE NOT NULL,
    to_date DATE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_salary_structure_assignments_emp ON salary_structure_assignments(employee_id, active)`);

  // --- Payroll: statutory configuration — editable, never hardcoded. Rates/slabs drift with law
  // changes and must stay a calibration knob; seeded here with today's best-known figures only as a
  // starting default the client should verify before relying on generated payslips for real payroll.

  await client.execute(`CREATE TABLE IF NOT EXISTS statutory_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pf_employee_pct REAL NOT NULL DEFAULT 12,
    pf_employer_pct REAL NOT NULL DEFAULT 12,
    pf_wage_ceiling REAL NOT NULL DEFAULT 15000,
    apply_pf_ceiling INTEGER NOT NULL DEFAULT 1,
    esi_employee_pct REAL NOT NULL DEFAULT 0.75,
    esi_employer_pct REAL NOT NULL DEFAULT 3.25,
    esi_wage_ceiling REAL NOT NULL DEFAULT 21000,
    standard_monthly_hours REAL NOT NULL DEFAULT 208,
    overtime_multiplier REAL NOT NULL DEFAULT 2,
    standard_deduction REAL NOT NULL DEFAULT 75000,
    tds_rebate_income_threshold REAL NOT NULL DEFAULT 1200000,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  const hasStatutoryRates = await client.execute('SELECT 1 FROM statutory_rates LIMIT 1');
  if (!hasStatutoryRates.rows.length) {
    await client.execute('INSERT INTO statutory_rates DEFAULT VALUES');
  }

  await client.execute(`CREATE TABLE IF NOT EXISTS professional_tax_slabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT NOT NULL,
    min_gross REAL NOT NULL,
    max_gross REAL, -- NULL = "and above"
    amount REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  // Telangana only (the company's own state, lib/db.js's suppliers/customers seed data) — add more
  // states via the admin UI when the company has employees elsewhere.
  const ptSeed = [['Telangana', 0, 15000, 0], ['Telangana', 15001, 20000, 150], ['Telangana', 20001, null, 200]];
  const hasPtSlabs = await client.execute('SELECT 1 FROM professional_tax_slabs LIMIT 1');
  if (!hasPtSlabs.rows.length) {
    for (const [state, minG, maxG, amt] of ptSeed) {
      await client.execute({ sql: 'INSERT INTO professional_tax_slabs (state, min_gross, max_gross, amount) VALUES (?, ?, ?, ?)', args: [state, minG, maxG, amt] });
    }
  }

  // New tax regime only — old regime (HRA exemption, 80C, other declarations) is out of scope, a
  // separate large rules engine (V3_CHANGES.md). Slabs seeded here are the best-known figures as of
  // this build (today's date, per the running session, is 2026-08-11 — FY2026-27); verify against
  // the actual Budget 2026 announcement before relying on this for real payroll, and correct via the
  // admin UI if it changed — this is exactly the kind of value that must stay editable, not trusted.
  await client.execute(`CREATE TABLE IF NOT EXISTS income_tax_slabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    regime TEXT NOT NULL DEFAULT 'new',
    financial_year TEXT NOT NULL,
    min_income REAL NOT NULL,
    max_income REAL, -- NULL = "and above"
    rate_pct REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  const taxSlabSeed = [
    [0, 400000, 0], [400001, 800000, 5], [800001, 1200000, 10], [1200001, 1600000, 15],
    [1600001, 2000000, 20], [2000001, 2400000, 25], [2400001, null, 30],
  ];
  const hasTaxSlabs = await client.execute('SELECT 1 FROM income_tax_slabs LIMIT 1');
  if (!hasTaxSlabs.rows.length) {
    for (const [minI, maxI, pct] of taxSlabSeed) {
      await client.execute({
        sql: `INSERT INTO income_tax_slabs (regime, financial_year, min_income, max_income, rate_pct) VALUES ('new', '2026-27', ?, ?, ?)`,
        args: [minI, maxI, pct],
      });
    }
  }

  await addColumn(client, 'employees', "pt_state TEXT NOT NULL DEFAULT 'Telangana'");

  // --- Payroll: execution (LWP-prorated, YTD-TDS-aware) -------------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | processed | submitted
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    UNIQUE(period_month, period_year)
  )`);

  // Every REAL column below is a stored fact only — ACCOUNTING INTEGRATION POINT for a future sync
  // to read; never posted to a ledger here.
  await client.execute(`CREATE TABLE IF NOT EXISTS salary_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_run_id INTEGER REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    salary_structure_assignment_id INTEGER REFERENCES salary_structure_assignments(id),
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    financial_year TEXT NOT NULL,
    slip_type TEXT NOT NULL DEFAULT 'regular', -- regular | final
    working_days REAL, payment_days REAL,
    gross_earnings REAL NOT NULL DEFAULT 0,
    total_deductions REAL NOT NULL DEFAULT 0,
    net_pay REAL NOT NULL DEFAULT 0,
    pf_employee REAL NOT NULL DEFAULT 0, pf_employer REAL NOT NULL DEFAULT 0,
    esi_employee REAL NOT NULL DEFAULT 0, esi_employer REAL NOT NULL DEFAULT 0,
    pt_amount REAL NOT NULL DEFAULT 0,
    tds_amount REAL NOT NULL DEFAULT 0,
    overtime_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | submitted | paid
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, period_month, period_year, slip_type)
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_salary_slips_emp_fy ON salary_slips(employee_id, financial_year)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS salary_slip_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salary_slip_id INTEGER NOT NULL REFERENCES salary_slips(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    component_type TEXT NOT NULL, -- earning | deduction
    amount REAL NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  // One-off arrears/bonus — non-recurring by design; a recurring allowance belongs in the salary
  // structure instead. Folded into whichever slip covers employee+period at generation time.
  await client.execute(`CREATE TABLE IF NOT EXISTS additional_salary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    component_type TEXT NOT NULL, -- earning | deduction
    amount REAL NOT NULL,
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    reason TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- Structured loans (EMI, reducing-balance amortization) --------------------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS employee_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    purpose TEXT,
    principal_amount REAL NOT NULL,
    interest_pct REAL NOT NULL DEFAULT 0,
    tenure_months INTEGER NOT NULL,
    emi_amount REAL NOT NULL,
    disbursed_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | closed | foreclosed
    outstanding_principal REAL NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS loan_repayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
    salary_slip_id INTEGER REFERENCES salary_slips(id),
    installment_no INTEGER NOT NULL,
    emi_amount REAL NOT NULL,
    principal_component REAL NOT NULL,
    interest_component REAL NOT NULL,
    outstanding_after REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Full & Final settlement — links a separation to the final slip that paid it out.
  await addColumn(client, 'employee_separation', 'settlement_slip_id INTEGER REFERENCES salary_slips(id)');

  // --- Expense Claims / Advances — workflow only, no GL (ACCOUNTING INTEGRATION POINT below) ------

  await client.execute(`CREATE TABLE IF NOT EXISTS expense_claim_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  const expenseTypeSeed = ['Travel', 'Food', 'Fuel', 'Office Supplies', 'Communication', 'Other'];
  const hasExpenseTypes = await client.execute('SELECT 1 FROM expense_claim_types LIMIT 1');
  if (!hasExpenseTypes.rows.length) {
    for (const name of expenseTypeSeed) {
      await client.execute({ sql: 'INSERT INTO expense_claim_types (name) VALUES (?)', args: [name] });
    }
  }

  await client.execute(`CREATE TABLE IF NOT EXISTS employee_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    purpose TEXT,
    amount REAL NOT NULL,
    advance_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested', -- requested | approved | paid | settled
    settled_amount REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ACCOUNTING INTEGRATION POINT: approved/paid claims + total_amount are what a future sync (e.g. a
  // Tally agent) reads; Shanti Ops never posts these to a ledger itself.
  await client.execute(`CREATE TABLE IF NOT EXISTS expense_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    claim_date DATE NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | submitted | approved | rejected | paid
    advance_id INTEGER REFERENCES employee_advances(id),
    approved_by TEXT,
    approved_at DATETIME,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS expense_claim_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_claim_id INTEGER NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
    expense_claim_type_id INTEGER REFERENCES expense_claim_types(id),
    expense_date DATE,
    amount REAL NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  // --- HR core leftover: attendance grace period (§13 non-blocking gap) ---------------------------
  await addColumn(client, 'shift_types', 'grace_minutes INTEGER NOT NULL DEFAULT 0');

  await seedIfEmpty(client);
  // Must run after seedIfEmpty (so a fresh DB's SB-1018 project exists to hang the demo sheet off)
  // and before seedCalcDemoData (so the demo sheet id exists for seedCalcDemoData to stamp).
  const demoCalcSheetId = await migrateCalcProjectHierarchy(client);
  await seedQcDemoData(client);
  await seedV3DemoData(client);
  await seedCalcDemoData(client, demoCalcSheetId);
  await seedCalcDrawings(client);

  // sales_head is new (Group 6, added to HEAD_USERS above) — seedIfEmpty only runs on a totally
  // empty DB, so an already-seeded DB (like the live Turso dev DB) needs this guarded one-off insert
  // to pick the new department head up, same idiom as seedQcDemoData's own re-run guards.
  const hasSalesHead = await client.execute("SELECT 1 FROM users WHERE username = 'sales_head' LIMIT 1");
  if (!hasSalesHead.rows.length) {
    const anyUsers = await client.execute("SELECT 1 FROM users LIMIT 1");
    if (anyUsers.rows.length) {
      await client.execute({
        sql: `INSERT INTO users (username, password, role, project_id, departments, display_name, project_ids)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['sales_head', bcrypt.hashSync('sales_head123', 10), 'operator', null, 'Sales', 'Sales Head', null]
      });
    }
  }

  // marketing_head — V3_CHANGES.md A1, same guarded one-off insert as sales_head above (the live
  // Turso dev DB is already seeded, so seedIfEmpty alone won't pick this new department head up).
  const hasMarketingHead = await client.execute("SELECT 1 FROM users WHERE username = 'marketing_head' LIMIT 1");
  if (!hasMarketingHead.rows.length) {
    const anyUsers2 = await client.execute("SELECT 1 FROM users LIMIT 1");
    if (anyUsers2.rows.length) {
      await client.execute({
        sql: `INSERT INTO users (username, password, role, project_id, departments, display_name, project_ids)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['marketing_head', bcrypt.hashSync('marketing_head123', 10), 'operator', null, 'Marketing', 'Marketing Head', null]
      });
    }
  }

  // hr_head — V3_CHANGES.md §12, same guarded one-off insert pattern as sales_head/marketing_head.
  const hasHrHead = await client.execute("SELECT 1 FROM users WHERE username = 'hr_head' LIMIT 1");
  if (!hasHrHead.rows.length) {
    const anyUsers3 = await client.execute("SELECT 1 FROM users LIMIT 1");
    if (anyUsers3.rows.length) {
      await client.execute({
        sql: `INSERT INTO users (username, password, role, project_id, departments, display_name, project_ids)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['hr_head', bcrypt.hashSync('hr_head123', 10), 'operator', null, 'HR', 'HR Head', null]
      });
    }
  }

  await seedV3HrData(client);
  await backfillSystemUsersIntoHr(client);
  await unifyWorkersIntoEmployees(client);

  // --- Phase 4: Production — Job Cards (PRODUCTION-MODULE-DESIGN.md) ----------------------------

  await client.execute(`CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    default_minutes INTEGER, active INTEGER NOT NULL DEFAULT 1
  )`);
  const operationSeed = ['Marking', 'Cutting', 'Rolling', 'Fit-up', 'Welding', 'Grinding', 'Machining', 'Painting', 'Testing/NDE'];
  const hasOps = await client.execute('SELECT 1 FROM operations LIMIT 1');
  if (!hasOps.rows.length) {
    for (const name of operationSeed) {
      await client.execute({ sql: 'INSERT INTO operations (name) VALUES (?)', args: [name] });
    }
  }

  await client.execute(`CREATE TABLE IF NOT EXISTS workstations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    machine_hour_rate REAL, active INTEGER NOT NULL DEFAULT 1
  )`);
  const workstationSeed = ['Marking Table', 'Plasma Cutter', 'Rolling Machine', 'Weld Bay 1', 'Weld Bay 2', 'CNC Lathe', 'Paint Booth'];
  const hasWs = await client.execute('SELECT 1 FROM workstations LIMIT 1');
  if (!hasWs.rows.length) {
    for (const name of workstationSeed) {
      await client.execute({ sql: 'INSERT INTO workstations (name) VALUES (?)', args: [name] });
    }
  }

  // Pay rate is HR-owned data, consumed by Production's labor costing (§3.6) — not the reverse.
  await addColumn(client, 'employees', 'cost_rate_per_hour REAL');

  // The shop-floor execution unit — scoped to a real Production milestone (lib/milestones.js
  // MILESTONE_TEMPLATE — e.g. "Shell Welding", "Box Up Welding (OS / IS / G)"), not an invented
  // generic step name. milestone_id is the primary scope; section/project_id are derived from it
  // server-side (POST /api/job-cards) so they can't drift out of sync with it. operation_id is now
  // optional — most milestones are already a single, specific action; it's a finer-grained tag only
  // for the few that bundle several verbs (e.g. "Marking, Cutting, Rolling Shell"). No FK
  // enforcement anywhere in this app (see the note on the old `workers`/`worker_days` tables), so
  // these are plain INTEGER columns, same convention as tasks.bom_item_id.
  await client.execute(`CREATE TABLE IF NOT EXISTS job_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id INTEGER REFERENCES milestones(id),
    section TEXT NOT NULL,
    bom_item_id INTEGER,
    operation_id INTEGER,
    workstation_id INTEGER REFERENCES workstations(id),
    qty_planned REAL NOT NULL DEFAULT 0,
    qty_done REAL NOT NULL DEFAULT 0,
    qty_rejected REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | progress | done
    is_paused INTEGER NOT NULL DEFAULT 0,
    planned_start DATE,
    planned_end DATE,
    actual_start DATETIME,
    actual_end DATETIME,
    is_outside INTEGER NOT NULL DEFAULT 0,
    outside_vendor TEXT,
    rework_of_job_card_id INTEGER,
    qc_record_id INTEGER,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_cards_project ON job_cards(project_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_cards_status ON job_cards(status)`);
  // No index on milestone_id here — on a DB where job_cards already existed in the pre-reshape
  // shape, CREATE TABLE IF NOT EXISTS above was a no-op and that column doesn't exist yet, so
  // indexing it here would crash every request (this is exactly what happened). Left entirely to
  // reshapeJobCardsForMilestone(), which only creates that index once the column is guaranteed to
  // exist — after the rebuild on an old table, or immediately on a fresh one.
  await reshapeJobCardsForMilestone(client);

  // hydro_test moved QC -> Production (lib/milestones.js). department is copied onto each row at
  // project-creation time, not derived live from the template, so already-seeded projects need
  // this too. Idempotent WHERE clause — safe to run every boot, no marker needed.
  await client.execute("UPDATE milestones SET department = 'Production' WHERE milestone_key = 'hydro_test' AND department != 'Production'");

  // Multiple work sessions per worker per card (breaks, next-day continuation) instead of one
  // running hours total — real shop-floor time capture, adopted from ERPNext's Time Log shape.
  // Labor cost = Σ minutes/60 × employee.cost_rate_per_hour.
  await client.execute(`CREATE TABLE IF NOT EXISTS job_card_time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_card_id INTEGER NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    from_time DATETIME,
    to_time DATETIME,
    minutes REAL NOT NULL DEFAULT 0,
    qty_completed REAL NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_jc_time_logs_card ON job_card_time_logs(job_card_id)`);

  // Welding rods, gas, discs — consumed doing the work, never a BOM line item. Free text by
  // design: no Item/Code master, no stock ledger (§3.1).
  await client.execute(`CREATE TABLE IF NOT EXISTS job_card_consumables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_card_id INTEGER NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    qty REAL,
    unit TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Stores → WIP, structured (§3.3) — replaces the free-text issued_ref/received_ref on bom_items
  // going forward; those columns stay untouched for old rows.
  await client.execute(`CREATE TABLE IF NOT EXISTS material_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bom_item_id INTEGER NOT NULL REFERENCES bom_items(id),
    job_card_id INTEGER REFERENCES job_cards(id),
    qty REAL NOT NULL,
    issued_by TEXT,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_material_issues_bom_item ON material_issues(bom_item_id)`);

  // Site vs shop-floor work (Site Marking, Welding FURA-B/RC/AR happen at the customer's site, not
  // the shop) — same is_outside precedent, a flag not a location taxonomy.
  await addColumn(client, 'job_cards', 'is_site INTEGER NOT NULL DEFAULT 0');

  // Multi-company (§2.6 -> resolved). Which legal entity — Shanti Boilers or Shanti Techno Fab —
  // is decided at the Sale Order, the actual commercial commitment, not typed onto a Project or a
  // job card after the fact (client point raised mid-build: the selection belongs "way earlier").
  // projects.company is a denormalized copy, same precedent as customer_name/order_value already
  // being copied onto projects from upstream — set from the sale order at project-creation time
  // when one exists, otherwise a manual fallback for projects created without going through Sales.
  await addColumn(client, 'sale_orders', "company TEXT NOT NULL DEFAULT 'Shanti Boilers'");
  await addColumn(client, 'projects', "company TEXT NOT NULL DEFAULT 'Shanti Boilers'");

  // The default above is wrong for every already-existing STF- project (e.g. STF-IBR-052) — this
  // build already documents a mechanical rule for exactly this (SYSTEM.md's "legal entity is
  // selected by the maker-number prefix" note, previously only applied to QC statutory documents):
  // STF- -> Shanti Techno Fab, everything else stays Shanti Boilers. Idempotent, safe every boot.
  await client.execute("UPDATE projects SET company = 'Shanti Techno Fab' WHERE project_no LIKE 'STF-%' AND company != 'Shanti Techno Fab'");

  // Payslip's company is a different axis from a project's — which entity employs this person, not
  // which entity sold this order. Same two known values, own column, HR-owned (mirrors cost_rate_per_hour).
  await addColumn(client, 'employees', "company TEXT NOT NULL DEFAULT 'Shanti Boilers'");

  // Manual-mode stock review gate (STORES-SALES-CHANGES.md) — deliberately NOT a new
  // purchase_status enum value (that would ripple into derivePurchaseStage/BomStageBar/
  // ProcurementFlow's 5-stage bar everywhere). A plain visibility flag instead: 1 means "a fresh
  // demand line, not yet reviewed by Stores" — getSourcingItems() excludes these from Procurement's
  // Enquiry queue entirely until Stores explicitly clicks Procure (clears the flag; purchase_status
  // itself never changes) or Reserve (fulfills it from stock; the line simply never needs
  // Procurement at all). DEFAULT 0 means every historical row is unaffected — the gate only ever
  // applies to rows explicitly created past this point.
  await addColumn(client, 'bom_items', 'pending_review INTEGER NOT NULL DEFAULT 0');

  // §3.2 catalog wiring (STORES-SALES-CHANGES.md) — the real join key items.id, NOT items.item_code:
  // confirmed against the real client export that only 1 of 2,773 rows actually has a populated
  // item_code (see the `items` table's own comment above), so item_code can't be a matching key
  // with real data. item_id is set only when a line is actually picked from the catalog search
  // (PrWorkspace's ItemSearchField, Stores' New Item dialog) — free-typed rows, and every row that
  // predates this, simply have it NULL and keep working exactly as before; there is no backfill.
  await addColumn(client, 'bom_items', 'item_id INTEGER REFERENCES items(id)');
  await addColumn(client, 'inventory_items', 'item_id INTEGER REFERENCES items(id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_bom_items_item_id ON bom_items(item_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_inventory_items_item_id ON inventory_items(item_id)');
}

// Add a column if it doesn't already exist. libsql throws "duplicate column name" on re-run — ignore that.
async function addColumn(client, table, columnDef) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    if (!String(e).toLowerCase().includes('duplicate column')) throw e;
  }
}

// CALC-CHANGES2.md §A — makes Calc Sheets' Registry (calc_variables), snapshots, and notes
// project+sheet-scoped instead of one global registry. Returns the demo calc_sheet id so
// seedCalcDemoData can stamp it on every seed row.
//
// calc_variables needs more than an addColumn: its `name` column is globally UNIQUE today, and two
// sheets both need to be able to hold a variable named "Pressure" — that requires relaxing the
// constraint to UNIQUE(calc_sheet_id, name), which SQLite can't do via ALTER (constraints are baked
// into CREATE TABLE). So this does the standard SQLite rebuild — new table, copy rows (ids
// preserved, since calc_notes.entity_id and calc_formulas.formula_id-linked rows point at them),
// drop, rename — guarded to run exactly once via a PRAGMA table_info check. Nothing FKs *into*
// calc_variables at the DB level (this app never turns PRAGMA foreign_keys on), so the drop/rename
// is safe. Same "migrate() does one-off destructive rebuilds when needed" precedent as the orphan
// calc_formulas DELETE above (idx_calc_formulas_output_var).
async function migrateCalcProjectHierarchy(client) {
  const demoProject = await client.execute("SELECT id FROM projects WHERE project_no = 'SB-1018'");
  if (!demoProject.rows.length) return null; // no demo project yet (shouldn't happen post-seedIfEmpty) — skip, nothing to backfill onto
  const projectId = demoProject.rows[0].id;

  let sheet = await client.execute({ sql: 'SELECT id FROM calc_sheets WHERE project_id = ? LIMIT 1', args: [projectId] });
  let sheetId;
  if (sheet.rows.length) {
    sheetId = Number(sheet.rows[0].id);
  } else {
    const res = await client.execute({
      sql: `INSERT INTO calc_sheets (project_id, name, created_by) VALUES (?, ?, ?)`,
      args: [projectId, 'Pressure Vessel Shell', 'system'],
    });
    sheetId = Number(res.lastInsertRowid);
  }

  const cols = await client.execute('PRAGMA table_info(calc_variables)');
  const alreadyRebuilt = cols.rows.some((c) => c.name === 'calc_sheet_id');
  if (!alreadyRebuilt) {
    await client.execute(`CREATE TABLE calc_variables_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calc_sheet_id INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'input',
      unit TEXT,
      dimension TEXT,
      value REAL,
      formula_id INTEGER,
      array_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(calc_sheet_id, name)
    )`);
    await client.execute({
      sql: `INSERT INTO calc_variables_new (id, calc_sheet_id, name, type, unit, dimension, value, formula_id, array_json, created_at)
            SELECT id, ?, name, type, unit, dimension, value, formula_id, array_json, created_at FROM calc_variables`,
      args: [sheetId],
    });
    await client.execute('DROP TABLE calc_variables');
    await client.execute('ALTER TABLE calc_variables_new RENAME TO calc_variables');
  }

  // calc_snapshots/calc_notes don't have a UNIQUE(name) to fight — a plain addColumn + backfill
  // (same idiom as tasks.project_id) is enough.
  await addColumn(client, 'calc_snapshots', 'calc_sheet_id INTEGER');
  await addColumn(client, 'calc_notes', 'calc_sheet_id INTEGER');
  await client.execute({ sql: 'UPDATE calc_snapshots SET calc_sheet_id = ? WHERE calc_sheet_id IS NULL', args: [sheetId] });
  // Only backfill variable notes onto the demo sheet — formula notes (entity_type='formula') stay
  // sheet-less on purpose, since Methodology is global.
  await client.execute({ sql: "UPDATE calc_notes SET calc_sheet_id = ? WHERE calc_sheet_id IS NULL AND entity_type = 'variable'", args: [sheetId] });

  return sheetId;
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

// V3_CHANGES.md A3/A4 demo data — erp_snapshot (source='demo') so the Executive 360 finance/HR
// tiles have something to show before ERPNext exists, plus a handful of opportunities so the
// Sales+Marketing pipeline isn't empty on a fresh demo. Guarded on each table's own row count
// (not seedIfEmpty's "totally empty DB" gate) since both tables are new and the live Turso dev DB
// is already seeded with everything else.
// V3_CHANGES.md §12 invariant amendment: hr_headcount dropped from this list — HR went native
// (real employees/attendance/leave data), so it's no longer erp_snapshot-sourced. Only Finance +
// statutory Payroll stay snapshot-backed. The one-off DELETE below cleans the stale row on an
// already-seeded DB (same guarded-one-off idiom as the marketing_head/hr_head inserts).
const V3_SNAPSHOT_METRICS = [
  { metric_key: 'receivables_outstanding', value_num: 4200000, value_text: '₹42,00,000' },
  { metric_key: 'cash_position', value_num: 8750000, value_text: '₹87,50,000' },
  { metric_key: 'invoice_total_mtd', value_num: 6100000, value_text: '₹61,00,000' },
  { metric_key: 'invoice_paid_mtd', value_num: 2600000, value_text: '₹26,00,000' },
  { metric_key: 'payroll_mtd', value_num: 1850000, value_text: '₹18,50,000' },
];
async function seedV3DemoData(client) {
  const snapCount = await client.execute('SELECT COUNT(*) AS n FROM erp_snapshot');
  if (snapCount.rows[0].n === 0) {
    for (const m of V3_SNAPSHOT_METRICS) {
      await client.execute({
        sql: `INSERT INTO erp_snapshot (metric_key, scope, value_num, value_text, source, as_of)
              VALUES (?, 'ALL', ?, ?, 'demo', CURRENT_TIMESTAMP)`,
        args: [m.metric_key, m.value_num, m.value_text]
      });
    }
  }

  const oppCount = await client.execute('SELECT COUNT(*) AS n FROM opportunities');
  if (oppCount.rows[0].n === 0) {
    const demoOpps = [
      ['Asian Brown — 8T boiler upgrade', 'Asian Brown', 'Quoted', 3200000, 60, 'Sales'],
      ['HKM Charitable — annual AMC renewal', 'HKM Charitable Trust', 'Qualified', 850000, 40, 'Sales'],
      ['Virchow Biotech — steam line expansion', 'Virchow Biotech', 'Lead', 5400000, 20, 'Sales'],
      ['Trade fair 2026 — inbound enquiries batch', null, 'Lead', 1200000, 10, 'Marketing'],
      ['Regional distributor tie-up — West zone', null, 'Won', 2100000, 100, 'Marketing'],
    ];
    for (const [title, customerName, stage, value, prob, dept] of demoOpps) {
      await client.execute({
        sql: `INSERT INTO opportunities
                (title, customer_name, stage, value_num, probability, owner_dept, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [title, customerName, stage, value, prob, dept, dept === 'Marketing' ? 'marketing_head' : 'sales_head']
      });
    }
  }

  // Cleans the stale hr_headcount demo row on an already-seeded DB, now that HR is native.
  await client.execute("DELETE FROM erp_snapshot WHERE metric_key = 'hr_headcount' AND source = 'demo'");
}

// V3_CHANGES.md §12 — idempotent HR backfill, guarded on each table's own row count exactly like
// seedV3DemoData. Two jobs: (1) absorb the single real `workers` row into `employees` as
// employee_type='worker' (decision 1 — workers/worker_days retired after this, not dropped, same
// `tickets` precedent as SYSTEM.md §3b), (2) create linked `staff` employees for existing
// role='operator' users (real people already in the system, not invented data) so the HR module
// isn't empty of the people who are already heads. Never touches PMs/customers — those aren't
// employees in the HR sense this module models.
async function seedV3HrData(client) {
  const empCount = await client.execute('SELECT COUNT(*) AS n FROM employees');
  if (empCount.rows[0].n > 0) return;

  const workers = await client.execute('SELECT * FROM workers');
  for (const w of workers.rows) {
    const code = await nextCounterValueInternal(client, 'employee_code', 1000);
    await client.execute({
      sql: `INSERT INTO employees (employee_code, name, employee_type, department, trade, active)
            VALUES (?, ?, 'worker', ?, ?, ?)`,
      args: [`EMP-${code}`, w.name, w.department, w.trade, w.active],
    });
  }

  const heads = await client.execute("SELECT * FROM users WHERE role = 'operator'");
  for (const u of heads.rows) {
    const code = await nextCounterValueInternal(client, 'employee_code', 1000);
    const dept = (u.departments || '').split(',')[0]?.trim() || null;
    await client.execute({
      sql: `INSERT INTO employees (employee_code, name, employee_type, department, user_id, active)
            VALUES (?, ?, 'staff', ?, ?, ?)`,
      args: [`EMP-${code}`, u.display_name || u.username, dept, u.id, u.active],
    });
  }

  // A couple of national holidays so the leave/attendance working-days math has something real
  // to exclude on top of the Sunday weekly-off constant (lib/hr.js).
  const holidaySeed = [['2026-01-26', 'Republic Day'], ['2026-08-15', 'Independence Day'], ['2026-10-02', 'Gandhi Jayanti']];
  for (const [d, name] of holidaySeed) {
    await client.execute({ sql: 'INSERT OR IGNORE INTO holidays (holiday_date, name) VALUES (?, ?)', args: [d, name] });
  }
}

// Access/HR invariant: every internal account must have a people-master row. This is separate
// from seedV3HrData because older databases may already contain employees and therefore skip its
// initial empty-table seed. It is idempotent, never overwrites an existing employee link, and does
// not invent a department when the account has none; an administrator can complete that HR record.
async function backfillSystemUsersIntoHr(client) {
  const users = await client.execute(
    "SELECT id, username, display_name, departments, active FROM users WHERE role IN ('admin', 'manager', 'executive', 'operator')"
  );
  for (const u of users.rows) {
    const linked = await client.execute('SELECT id FROM employees WHERE user_id = ? LIMIT 1', [u.id]);
    if (linked.rows.length) {
      await client.execute('UPDATE employees SET access_departments = ? WHERE user_id = ?', [u.departments || null, u.id]);
      continue;
    }
    const code = await nextCounterValueInternal(client, 'employee_code', 1000);
    const department = String(u.departments || '').split(',').map(s => s.trim()).filter(Boolean)[0] || null;
    await client.execute({
      sql: `INSERT INTO employees (employee_code, name, employee_type, department, user_id, active)
            VALUES (?, ?, 'staff', ?, ?, ?)`,
      args: [`EMP-${code}`, u.display_name || u.username, department, u.id, u.active ? 1 : 0],
    });
  }

  // One-time requested demo roster. The admin matrix remains the ongoing source of truth; this
  // marker prevents a later migration from overwriting an administrator's changes.
  await client.execute(`CREATE TABLE IF NOT EXISTS system_migrations (migration_key TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const marker = await client.execute("SELECT migration_key FROM system_migrations WHERE migration_key = 'design_engineering_responsibilities_v1'");
  if (!marker.rows.length) {
    const roster = {
      design_head: { departments: 'Design', roles: { Design: 'head' } },
      jaganmohan: { departments: 'Design,Engineering', roles: { Design: 'head', Engineering: 'head' } },
      ravi: { departments: 'Design,Engineering', roles: { Design: 'designer', Engineering: 'designer' } },
      vijay: { departments: 'Design,Engineering', roles: { Design: 'designer', Engineering: 'designer' } },
    };
    for (const [username, config] of Object.entries(roster)) {
      const account = await client.execute('SELECT id FROM users WHERE username = ?', [username]);
      if (!account.rows.length) continue;
      const id = account.rows[0].id;
      await client.execute('UPDATE users SET departments = ?, department_roles = ? WHERE id = ?', [config.departments, JSON.stringify(config.roles), id]);
      await client.execute('UPDATE employees SET access_departments = ? WHERE user_id = ?', [config.departments, id]);
    }
    await client.execute("INSERT INTO system_migrations (migration_key) VALUES ('design_engineering_responsibilities_v1')");
  }
}

// PRODUCTION-MODULE-DESIGN.md §2.5 — one people master, no second roster. seedV3HrData only ever
// copied `workers` into `employees` once, on an empty employees table, so any worker added via the
// Production panel afterwards never reached HR — the roster drift this migration fixes for good
// (Production's create/edit endpoints now write `employees` directly, so drift can't recur). Runs
// once (guarded by its own marker, not a row-count check, so it still catches drift from the
// window after seedV3HrData's snapshot), then DROPS both source tables — no permanent duplicate
// roster left sitting in the schema once the copy is done.
async function unifyWorkersIntoEmployees(client) {
  const marker = await client.execute("SELECT 1 FROM system_migrations WHERE migration_key = 'workers_unified_into_employees_v1'");
  if (marker.rows.length) return;

  // Created here, guarded by the same marker, purely so this one-time copy has a source to read —
  // both are dropped at the end of this function. A DB that already migrated skips this block
  // entirely (marker check above), so they're never resurrected as empty tables.
  await client.execute(`CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, trade TEXT,
    department TEXT NOT NULL DEFAULT 'Production', active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS worker_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL, date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'present', project_id INTEGER, milestone_id INTEGER, notes TEXT,
    created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(worker_id, date)
  )`);

  const missing = await client.execute(`
    SELECT w.* FROM workers w
    WHERE NOT EXISTS (
      SELECT 1 FROM employees e WHERE e.name = w.name AND e.department = w.department AND e.employee_type = 'worker'
    )`);
  for (const w of missing.rows) {
    const code = await nextCounterValueInternal(client, 'employee_code', 1000);
    await client.execute({
      sql: `INSERT INTO employees (employee_code, name, employee_type, department, trade, active)
            VALUES (?, ?, 'worker', ?, ?, ?)`,
      args: [`EMP-${code}`, w.name, w.department, w.trade, w.active],
    });
  }

  // worker_days -> attendance_days, matched by the same name+department join (there is no shared
  // numeric id between the two roster tables). INSERT OR IGNORE against attendance_days'
  // UNIQUE(employee_id, date) makes this safe even if some rows were already copied by hand.
  await client.execute(`
    INSERT OR IGNORE INTO attendance_days (employee_id, date, status, project_id, milestone_id, notes, created_by, created_at)
    SELECT e.id, wd.date, wd.status, wd.project_id, wd.milestone_id, wd.notes, wd.created_by, wd.created_at
      FROM worker_days wd
      JOIN workers w ON w.id = wd.worker_id
      JOIN employees e ON e.name = w.name AND e.department = w.department AND e.employee_type = 'worker'`);

  await client.execute('DROP TABLE IF EXISTS worker_days');
  await client.execute('DROP TABLE IF EXISTS workers');
  await client.execute("INSERT INTO system_migrations (migration_key) VALUES ('workers_unified_into_employees_v1')");
}

// job_cards was first built scoped to a free-text section + a required, invented `operations`
// list — before checking whether this codebase already had the real milestone vocabulary
// (lib/milestones.js). It did. This corrects that: milestone_id becomes the primary scope,
// operation_id becomes optional. Guarded by PRAGMA table_info rather than a system_migrations
// marker alone, so it's a no-op once the live table already has the new shape, and safely rebuilds
// (preserving row ids, so job_card_time_logs/job_card_consumables' job_card_id references stay
// valid) if it doesn't. job_cards is new this session — expect zero or a handful of test rows.
async function reshapeJobCardsForMilestone(client) {
  const cols = await client.execute('PRAGMA table_info(job_cards)');
  if (cols.rows.some(c => c.name === 'milestone_id')) return;

  await client.execute(`CREATE TABLE job_cards_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id INTEGER REFERENCES milestones(id),
    section TEXT NOT NULL,
    bom_item_id INTEGER,
    operation_id INTEGER,
    workstation_id INTEGER REFERENCES workstations(id),
    qty_planned REAL NOT NULL DEFAULT 0,
    qty_done REAL NOT NULL DEFAULT 0,
    qty_rejected REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    is_paused INTEGER NOT NULL DEFAULT 0,
    planned_start DATE,
    planned_end DATE,
    actual_start DATETIME,
    actual_end DATETIME,
    is_outside INTEGER NOT NULL DEFAULT 0,
    outside_vendor TEXT,
    rework_of_job_card_id INTEGER,
    qc_record_id INTEGER,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.execute(`
    INSERT INTO job_cards_v2 (id, project_id, section, bom_item_id, operation_id, workstation_id,
      qty_planned, qty_done, qty_rejected, status, is_paused, planned_start, planned_end,
      actual_start, actual_end, is_outside, outside_vendor, rework_of_job_card_id, qc_record_id,
      notes, created_by, created_at, updated_at)
    SELECT id, project_id, section, bom_item_id, operation_id, workstation_id,
      qty_planned, qty_done, qty_rejected, status, is_paused, planned_start, planned_end,
      actual_start, actual_end, is_outside, outside_vendor, rework_of_job_card_id, qc_record_id,
      notes, created_by, created_at, updated_at
    FROM job_cards`);
  await client.execute('DROP TABLE job_cards');
  await client.execute('ALTER TABLE job_cards_v2 RENAME TO job_cards');
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_cards_project ON job_cards(project_id)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_cards_status ON job_cards(status)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_job_cards_milestone ON job_cards(milestone_id)`);
}

// Seeds the Calc module's demo methodology — ported from the isolated prototype's seedState():
// a pressure-vessel shell-thickness formula (ASME UG-27(c)(1)) feeding a plate-size selector, plus
// the two validation rules that check the selection covers the requirement.
//
// Guarded per-row (not one top-level count check) so a run interrupted partway — a dev server that
// dies mid-migrate, e.g. — self-heals on the next boot instead of wedging permanently: a top-level
// "if any formula exists, skip everything" guard would otherwise treat an orphan formula-with-no-
// version as "already seeded" forever. Same idiom as the sales_head/marketing_head guarded inserts
// above.
// CALC-CHANGES2.md §A — sheetId is the demo calc_sheets row (migrateCalcProjectHierarchy's return
// value); every seed variable/snapshot/note now belongs to it instead of being global. Falls back
// to a null-scoped lookup if the demo project somehow doesn't exist yet (defensive only — see
// migrateCalcProjectHierarchy's own early-return).
async function seedCalcDemoData(client, sheetId) {
  const upsertVar = async (name, type, unit, value) => {
    const existing = await client.execute({ sql: 'SELECT id FROM calc_variables WHERE name = ? AND calc_sheet_id IS ?', args: [name, sheetId] });
    if (existing.rows.length) return Number(existing.rows[0].id);
    const res = await client.execute({
      sql: `INSERT INTO calc_variables (calc_sheet_id, name, type, unit, value) VALUES (?, ?, ?, ?, ?)`,
      args: [sheetId, name, type, unit, value],
    });
    return Number(res.lastInsertRowid);
  };
  // Phase 3, item 14 (array/list variables) — a fixed-columns list variable (tube bundle, nozzle
  // schedule); SUM/COUNT read it inside formula expressions (lib/calc-engine.js).
  const upsertArrayVar = async (name, columns, rows) => {
    const existing = await client.execute({ sql: 'SELECT id FROM calc_variables WHERE name = ? AND calc_sheet_id IS ?', args: [name, sheetId] });
    if (existing.rows.length) return Number(existing.rows[0].id);
    const res = await client.execute({
      sql: `INSERT INTO calc_variables (calc_sheet_id, name, type, unit, array_json) VALUES (?, ?, 'array', '-', ?)`,
      args: [sheetId, name, JSON.stringify({ columns, rows })],
    });
    return Number(res.lastInsertRowid);
  };
  await upsertVar('Pressure', 'input', 'bar', 42);
  await upsertVar('Radius', 'input', 'mm', 650);
  await upsertVar('WeldEfficiency', 'constant', '-', 0.85);
  // Phase 3, item 12 (safety-factor/margin configuration) — a named, editable design margin instead
  // of a hardcoded 0.15 inside the validation expression. Shows up in Design inputs and the PDF
  // report like any other constant, and any formula/validation can reference it by name.
  await upsertVar('DesignMarginPct', 'constant', '-', 0.15);
  // Phase 1.3 acceptance test (Kimi's brief): AllowableStress is no longer a hardcoded constant —
  // it's looked up from a real material table by Temperature (see the SA516_70 table + the
  // "Allowable stress" formula seeded below). AllowableStress itself becomes computed.
  await upsertVar('Temperature', 'input', 'degC', 250);

  const upsertFormula = async (name, outputVar, unit, status, source, expr, note, guardExpr = null) => {
    let formulaId;
    const existingFormula = await client.execute({ sql: 'SELECT id FROM calc_formulas WHERE output_var = ?', args: [outputVar] });
    if (existingFormula.rows.length) {
      formulaId = Number(existingFormula.rows[0].id);
    } else {
      const res = await client.execute({
        sql: `INSERT INTO calc_formulas (name, output_var, unit, cur_v, status, source_standard, source_clause, source_url, source_edition)
              VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        args: [name, outputVar, unit, status, source?.standard || null, source?.clause || null, source?.url || null, source?.edition || null],
      });
      formulaId = Number(res.lastInsertRowid);
    }
    const existingVersion = await client.execute({ sql: 'SELECT id FROM calc_formula_versions WHERE formula_id = ? AND v = 1', args: [formulaId] });
    if (!existingVersion.rows.length) {
      await client.execute({
        sql: `INSERT INTO calc_formula_versions (formula_id, v, expr, note, guard_expr) VALUES (?, 1, ?, ?, ?)`,
        args: [formulaId, expr, note, guardExpr],
      });
    }
    const varId = await upsertVar(outputVar, 'computed', unit, null);
    await client.execute({ sql: `UPDATE calc_variables SET formula_id = ?, type = 'computed' WHERE id = ?`, args: [formulaId, varId] });
    return formulaId;
  };

  const upsertFormulaTest = async (formulaId, name, inputs, expectedOutput, tolerance) => {
    const existing = await client.execute({ sql: 'SELECT id FROM calc_formula_tests WHERE formula_id = ? AND name = ?', args: [formulaId, name] });
    if (existing.rows.length) return;
    await client.execute({
      sql: `INSERT INTO calc_formula_tests (formula_id, name, inputs_json, expected_output, tolerance) VALUES (?, ?, ?, ?, ?)`,
      args: [formulaId, name, JSON.stringify(inputs), expectedOutput, tolerance],
    });
  };

  // Phase 1.3 (lookup tables) — a small illustrative excerpt of SA-516 Grade 70 allowable stress
  // vs. temperature (ASME BPVC Section II-D, Table 1A). Deliberately just a few representative
  // points, not a certified data set — Kimi's brief calls for 2-3 public rows as demo data, real
  // material data has to come from Shanti's own QA/material certs later (see SYSTEM.md §5f, "Not
  // modeled at all — needs real Shanti data first").
  const existingTable = await client.execute({ sql: 'SELECT id FROM calc_tables WHERE name = ?', args: ['SA516_70'] });
  let sa516TableId;
  if (existingTable.rows.length) {
    sa516TableId = Number(existingTable.rows[0].id);
  } else {
    const res = await client.execute({
      sql: `INSERT INTO calc_tables (name, standard, x_column, x_unit, columns) VALUES (?, ?, ?, ?, ?)`,
      args: ['SA516_70', 'ASME BPVC Section II-D, Table 1A (illustrative excerpt)', 'Temperature', 'degC', JSON.stringify([{ name: 'AllowableStress', unit: 'MPa' }])],
    });
    sa516TableId = Number(res.lastInsertRowid);
  }
  const sa516Rows = [[20, 138], [100, 138], [200, 130], [300, 120], [400, 106]];
  for (let i = 0; i < sa516Rows.length; i++) {
    const [temp, stress] = sa516Rows[i];
    const existingRow = await client.execute({ sql: 'SELECT id FROM calc_table_rows WHERE table_id = ? AND x_value = ?', args: [sa516TableId, temp] });
    if (existingRow.rows.length) continue;
    await client.execute({
      sql: `INSERT INTO calc_table_rows (table_id, x_value, values_json, sort_order) VALUES (?, ?, ?, ?)`,
      args: [sa516TableId, temp, JSON.stringify({ AllowableStress: stress }), i],
    });
  }

  await upsertFormula(
    'Allowable stress (SA-516 Gr. 70)', 'AllowableStress', 'MPa', 'approved',
    { standard: 'ASME BPVC Section II-D', clause: 'Table 1A, SA-516 Grade 70 (illustrative excerpt)', edition: '2023 Edition', url: null },
    'LOOKUP("SA516_70", Temperature, "AllowableStress")',
    'Looked up from the SA516_70 material table by Temperature — Phase 1.3'
  );
  const requiredThicknessId = await upsertFormula(
    'Required thickness', 'RequiredThickness', 'mm', 'approved',
    { standard: 'ASME BPVC Section VIII, Division 1', clause: 'UG-27(c)(1)', edition: '2023 Edition', url: 'https://www.asme.org/codes-standards/bpvc-standards' },
    '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure)',
    'Initial formula, imported from Library — ASME VIII-1 UG-27(c)(1)'
  );
  // Phase 1.4 (regression test harness) — two worked examples, hand-verified against the real
  // unit-aware + LOOKUP-aware pipeline (not just the raw arithmetic) so they double as a live check
  // that Phase 1.1/1.3 keep producing the right number for this formula as it evolves.
  await upsertFormulaTest(
    requiredThicknessId, 'Design case: 42 bar @ 250°C',
    { Pressure: 42, Radius: 650, Temperature: 250, WeldEfficiency: 0.85 }, 26.318, 0.01
  );
  await upsertFormulaTest(
    requiredThicknessId, 'Low-pressure case: 10 bar @ 100°C',
    { Pressure: 10, Radius: 500, Temperature: 100, WeldEfficiency: 1.0 }, 3.639, 0.01
  );
  await upsertFormula(
    'Selected thickness', 'SelectedThickness', 'mm', 'approved', null,
    'nextStandard(RequiredThickness)',
    'Round up to next available standard plate size'
  );

  // Phase 2.1 (multi-domain chain) — a thermal (flue-gas side) domain feeding the existing
  // mechanical (shell thickness) domain via the validation layer, not by editing the approved
  // RequiredThickness formula's expression (that would force a version bump + re-approval on every
  // seed boot). Also the item that finally gives Phase 1.2's iteration/convergence engine a live
  // in-app demo: HeatTransferCoefficient and GasVelocity are a genuine 2-way cycle (illustrative
  // h ~ v^0.8 correlation feeding back through gas cooling), same shape as Kimi's brief's own
  // example (coefficient depends on velocity depends back on the coefficient).
  await upsertVar('ReferenceVelocity', 'constant', 'm/s', 20);
  await upsertVar('FilmCoeffConstant', 'constant', '-', 45);
  await upsertVar('CoolingFactor', 'constant', '-', 0.04);
  await upsertVar('ErosionConstant', 'constant', 'mm', 0.05);
  await upsertFormula(
    'Gas-side film coefficient', 'HeatTransferCoefficient', '-', 'approved',
    { standard: 'Illustrative correlation', clause: 'h ∝ v^0.8 (Dittus-Boelter-shaped)', url: null },
    'FilmCoeffConstant * (GasVelocity / ReferenceVelocity) ^ 0.8',
    'Thermal domain — Phase 2.1. Illustrative, not a certified correlation (see SYSTEM.md §5f).'
  );
  await upsertFormula(
    'Flue gas velocity (cooling-corrected)', 'GasVelocity', 'm/s', 'approved', null,
    'ReferenceVelocity * (1 - CoolingFactor * HeatTransferCoefficient / 100)',
    'Higher film coefficient -> more heat pickup -> gas cools -> velocity drops for the same flow. Closes the cycle with HeatTransferCoefficient.'
  );
  await upsertFormula(
    'Thermal corrosion allowance', 'ThermalCorrosionAllowance', 'mm', 'approved', null,
    'ErosionConstant * HeatTransferCoefficient',
    'Gas-side erosion/corrosion allowance driven by the thermal domain — feeds the mechanical domain via the sizing-margin validation below.'
  );

  // Phase 2.4 (conditional formula execution) — a guarded formula that only applies when
  // Temperature is below water's boiling point (flue gas can condense in the duct below ~100degC,
  // which corrodes differently and needs its own margin). Guard is plain input/constant-only, per
  // the restriction noted on computeAll. At the seeded Temperature (250degC) the guard is false, so
  // this is skipped by default — lower Temperature below 100 in the Project panel to see it switch on.
  await upsertFormula(
    'Condensate drain allowance', 'CondensateDrainAllowance', 'mm', 'approved', null,
    '2', 'Flat illustrative allowance for flue-gas condensate corrosion below the dew point — Phase 2.4 demo.',
    'Temperature < 100'
  );

  // Phase 3, item 14 (array/list variables) — a nozzle schedule (fixed columns, N rows). SUM/COUNT
  // read it by name inside a formula expression; areas are illustrative (pi*(d/2)^2, not a real
  // reinforcement calc — see SYSTEM.md §5f for the "needs real Shanti data" caveat).
  await upsertArrayVar('NozzleSchedule', ['Label', 'Diameter', 'Area'], [
    { Label: 'N1 (manway)', Diameter: 450, Area: 1590.4 },
    { Label: 'N2 (feed inlet)', Diameter: 80, Area: 50.3 },
    { Label: 'N3 (steam outlet)', Diameter: 150, Area: 176.7 },
    { Label: 'N4 (drain)', Diameter: 50, Area: 19.6 },
  ]);
  await upsertVar('MaxNozzleAreaAllowed', 'constant', 'mm2', 2000);
  await upsertFormula(
    'Total nozzle opening area', 'TotalNozzleArea', 'mm2', 'approved', null,
    'SUM("NozzleSchedule", "Area")',
    'Array/list variable demo (Phase 3, item 14) — sums the Area column of the NozzleSchedule array variable.'
  );
  await upsertFormula(
    'Nozzle count', 'NozzleCount', '-', 'approved', null,
    'COUNT("NozzleSchedule")',
    'Array/list variable demo (Phase 3, item 14) — row count of the NozzleSchedule array variable.'
  );

  const upsertValidation = async (name, expr, severity, message) => {
    const existing = await client.execute({ sql: 'SELECT id FROM calc_validations WHERE name = ?', args: [name] });
    if (existing.rows.length) return;
    await client.execute({
      sql: `INSERT INTO calc_validations (name, expr, severity, message) VALUES (?, ?, ?, ?)`,
      args: [name, expr, severity, message],
    });
  };
  await upsertValidation(
    'Selected thickness covers required thickness', 'SelectedThickness >= RequiredThickness',
    'fail', 'Selected plate size is thinner than the calculated requirement.'
  );
  await upsertValidation(
    'Sizing margin under design margin', '(SelectedThickness - RequiredThickness) / SelectedThickness < DesignMarginPct',
    'warning', 'Less than the configured design margin between required and selected thickness — consider the next standard size.'
  );
  await upsertValidation(
    'Thermal corrosion margin', '(SelectedThickness - RequiredThickness) >= ThermalCorrosionAllowance',
    'warning', 'Sizing margin does not cover the thermal-domain (gas-side erosion/corrosion) allowance — consider the next standard size or review flue-gas velocity.'
  );
  await upsertValidation(
    'Total nozzle area within limit', 'TotalNozzleArea <= MaxNozzleAreaAllowed',
    'warning', 'Combined nozzle opening area exceeds the configured limit — review the nozzle schedule or shell reinforcement.'
  );

  // Phase 3, item 16 (calculation templates) — the seeded defaults themselves, saved as the one
  // shipped template so "start from a known scenario" is demoable without a user having to create
  // one first.
  const existingTemplate = await client.execute({ sql: 'SELECT id FROM calc_templates WHERE name = ?', args: ['Fire Tube Boiler — Standard'] });
  if (!existingTemplate.rows.length) {
    await client.execute({
      sql: `INSERT INTO calc_templates (name, description, values_json) VALUES (?, ?, ?)`,
      args: [
        'Fire Tube Boiler — Standard',
        'Baseline design inputs for a standard 3-pass fire tube boiler shell calculation.',
        JSON.stringify({
          Pressure: 42, Radius: 650, Temperature: 250, WeldEfficiency: 0.85, DesignMarginPct: 0.15,
          ReferenceVelocity: 20, FilmCoeffConstant: 45, CoolingFactor: 0.04, ErosionConstant: 0.05,
          MaxNozzleAreaAllowed: 2000,
        }),
      ],
    });
  }

  // Phase 3, item 13 (engineering notes) — one seeded example so the feature is demoable without a
  // user having to write the first note themselves.
  const requiredThicknessNote = await client.execute({ sql: 'SELECT id FROM calc_formulas WHERE output_var = ?', args: ['RequiredThickness'] });
  if (requiredThicknessNote.rows.length) {
    const formulaId = Number(requiredThicknessNote.rows[0].id);
    const existingNote = await client.execute({ sql: 'SELECT id FROM calc_notes WHERE entity_type = ? AND entity_id = ?', args: ['formula', formulaId] });
    if (!existingNote.rows.length) {
      await client.execute({
        sql: `INSERT INTO calc_notes (entity_type, entity_id, author, note) VALUES ('formula', ?, ?, ?)`,
        args: [formulaId, 'design_head', 'Thin-wall formula only — re-check against UG-27(c)(2) if t exceeds R/2 on a future revision.'],
      });
    }
  }
}

// CALC-CHANGES2.md §B — 6 demo drawings on the demo project (SB-1018), mixed statuses, guarded to
// insert once (same "count === 0" idiom as seedQcDemoData's document half).
async function seedCalcDrawings(client) {
  const demoProject = await client.execute("SELECT id FROM projects WHERE project_no = 'SB-1018'");
  if (!demoProject.rows.length) return;
  const projectId = demoProject.rows[0].id;

  const existing = await client.execute('SELECT COUNT(*) AS n FROM calc_drawings WHERE project_id = ?', [projectId]);
  if (existing.rows[0].n > 0) return;

  const drawings = [
    { name: 'GA Drawing', drawing_type: 'General Arrangement', status: 'approved' },
    { name: 'Pressure Plan', drawing_type: 'Pressure Part', status: 'approved' },
    { name: 'Welding Detail', drawing_type: 'Welding', status: 'under_review' },
    { name: 'Field Line Drawing', drawing_type: 'Piping', status: 'in_progress' },
    { name: 'BOP Drawing', drawing_type: 'Balance of Plant', status: 'in_progress' },
    { name: 'Foundation Drawing', drawing_type: 'Civil', status: 'not_started' },
  ];
  for (const d of drawings) {
    await client.execute({
      sql: `INSERT INTO calc_drawings (project_id, name, drawing_type, status) VALUES (?, ?, ?, ?)`,
      args: [projectId, d.name, d.drawing_type, d.status],
    });
  }
}

// Same INSERT...ON CONFLICT upsert nextCounterValue() uses, taking an already-open client instead
// of calling initDB() again — seed functions run inside migrate() before initDB()'s own promise
// resolves, so nextCounterValue() itself can't be called here (it would re-enter initDB()).
async function nextCounterValueInternal(client, counterName, startAt) {
  const result = await client.execute({
    sql: `INSERT INTO counters (name, value) VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET value = value + 1
          RETURNING value`,
    args: [counterName, startAt + 1],
  });
  return result.rows[0].value;
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
  sales_head: 'Sales', // V2-CHANGES.md Group 6 Phase 6.1
  marketing_head: 'Marketing', // V3_CHANGES.md A1
  hr_head: 'HR', // V3_CHANGES.md §12
};

// Which operator owns each department's work, so "My Work" is populated.
const DEPT_ASSIGNEE = {
  Design: 'design_head', 
  Procurement: 'procurement_head', 
  Production: 'production_head',
  QC: 'qc_head', 
  Dispatch: 'dispatch_head', 
  Installation: 'installation_head', 
};
const DELAY_REASONS = ['Pump vendor delay', 'Awaiting client drawing approval', 'MS plate shortage'];
const DEPT_DELAY_CAT = { 
  Procurement: 'Vendor', 
  Production: 'Material', 
  Design: 'Design', 
  QC: 'Other', 
  Dispatch: 'Material', 
  Installation: 'Customer' 
};

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

// Run a related set of writes atomically on both local SQLite and Turso/libSQL. Keep external
// side effects (notifications, file storage, audit calls) outside this callback so the database
// transaction stays short and failures cannot leave half-created business records behind.
export async function withTransaction(work) {
  const tx = await (await initDB()).transaction('write');
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    tx.close();
  }
}

// One atomic upsert, not a read-then-UPDATE: the old two-step version's UPDATE matched zero rows
// for any counter name that was never pre-seeded with an INSERT (project_no/packing_no/po_no all
// are, in seedIfEmpty — pr_no, added later by Group 5 Bundle A, never was), so it silently
// recomputed the same "next" value forever and every call after the first collided on the table's
// UNIQUE constraint. Found live testing Group 6 Phase 6.3 (V2-CHANGES.md) via a real pr_no clash.
// ON CONFLICT DO UPDATE fixes both the missing-row case and the underlying non-atomicity in one
// query — counters.name is the table's PRIMARY KEY, so this is a real upsert.
export async function nextCounterValue(counterName, startAt = 1000) {
  const client = await initDB();
  const result = await client.execute({
    sql: `INSERT INTO counters (name, value) VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET value = value + 1
          RETURNING value`,
    args: [counterName, startAt + 1]
  });
  return result.rows[0].value;
}

export async function nextNumber(counterName, prefix) {
  const next = await nextCounterValue(counterName);
  return `${prefix}-${next}`;
}
