// Department help content for /help. This is intentionally plain data: the renderer owns layout,
// while each department owns its vocabulary, feature order, and practical how-to guidance.
import {
  BookOpenIcon, MailIcon, ClipboardListIcon, CalculatorIcon, FolderKanbanIcon, FileInputIcon,
  RulerIcon, DraftingCompassIcon, SearchIcon, GitCompareIcon, FileTextIcon, TruckIcon,
  WarehouseIcon, PackageCheckIcon, BoxesIcon, UsersIcon, CalendarDaysIcon, HardHatIcon,
  FlaskConicalIcon, BadgeCheckIcon, ClipboardCheckIcon, MapPinIcon, RouteIcon, ShoppingCartIcon,
  UserPlusIcon, Building2Icon, MegaphoneIcon, TrendingUpIcon, PhoneIcon, BarChart3Icon,
  UserRoundIcon, UserCheckIcon, Clock3Icon, IndianRupeeIcon, ReceiptIcon, ShieldCheckIcon,
  ListChecksIcon, MessageSquareIcon, WrenchIcon, BellIcon, TagIcon, InboxIcon, UndoIcon,
  ScissorsIcon, ClipboardIcon, AlertTriangleIcon, LogInIcon, FileOutputIcon,
  HeadsetIcon, FileSignatureIcon, CalendarCheckIcon, CameraIcon, LayersIcon, Repeat2Icon, FileEditIcon, Undo2Icon,
  LandmarkIcon, PercentIcon, BookIcon, LockIcon, LayoutTemplateIcon, SlidersHorizontalIcon,
} from 'lucide-react';

// System-architecture diagrams (2026-08-27) — verified against the actual schema/routes, not the
// hand-drawn reference diagram it was requested from. Three corrections worth remembering, since a
// future edit could easily "fix" these back to the more obvious-looking wrong shape:
//   1. Drawing / Calc Sheet / BOM Line / Reservation / Material Issue have NO generated business
//      code anywhere — they're identified by their own free-text name (drawing/calc sheet) or a
//      plain numeric row id (BOM line, reservation, material issue, inventory_batches). Only
//      Project (SB-####), PR (PR-####), PO (NNN/SB/YYYY-YY), Job Card (JC-####), inward receipt
//      (INW-####), stock piece (PL-#### plate / LN-#### linear), serial (SR-####), and NCR
//      (NCR-####) are real generated codes (lib/db.js's nextNumber()/nextCounterValue()).
//   2. A BOM line usually already exists before Procurement ever sees it (bulk PMB import from
//      Design) — a Purchase Requisition (PR-####) is the minority path, raised by Eng/Design/Stores
//      to CREATE a new bom_items row, not something every BOM line passes through.
//   3. A Job Card (job_sheets) is one per project/unit with fixed stages; it is not created by a
//      Material Issue. Material reaches Production through a Material Indent that Stores releases.
// PL-#### is also a real prefix collision, left as-is rather than smoothed over: a stock piece
// (lib/stock-pieces.js) and a Dispatch packing list (nextNumber('packing_no','PL')) both generate
// "PL-####" from unrelated counters — genuinely ambiguous out of context, not a typo here.
const END_TO_END_TRACEABILITY_DIAGRAM =
`PROJECT  (project_no, e.g. SB-1040)
   │
   ├──────────────────────┬───────────────────────┐
   ▼                       ▼                       │
DRAWING                 CALC SHEET                 │
(calc_drawings:         (calc_sheets:               │
 name + revision —       name — no generated        │
 no generated code)      code)                       │
   │                       │                         │
   └───────────┬───────────┘                         │
               ▼                                     │
        BOM LINE  (bom_items — plain row id,          │
                    no generated code)                │
        material / qty / spec                        │
        drawing_revision_at_release  (frozen snapshot)│
        requires: heat no · MTC · supplier batch · serial no
               │
          Release BOM  (freezes the drawing-revision snapshot above)
               │
   ┌───────────┴──────────────────┐
   ▼                               ▼
already a BOM line          raised as a NEW need
(bulk PMB import —          (Eng / Design / Stores)
 the common path)           PURCHASE REQUISITION  PR-####
   │                        → itself creates the BOM line
   └───────────┬──────────────────┘
               ▼
   Enquiry → Comparison → Ordered → Transit   (purchase_status ladder)
               │
      select supplier, issue PO
               ▼
   PURCHASE ORDER   po_no = NNN/SB/YYYY-YY
               │
         material arrives
               ▼
┌─────────────────────────────────────────────────────────────┐
│                            STORES                            │
│  STOCK RECEIPT  (stock_receipts.inward_batch_no, INW-####)   │
│               │                                              │
│      tracking_mode on the inventory line                     │
│  ┌────────┬────────────────┬─────────────────┬────────────┐ │
│  ▼        ▼                ▼                  ▼            │ │
│ scalar   PIECE            BATCH              SERIAL         │ │
│ on_hand  stock_pieces     inventory_batches  inventory_     │ │
│          PL-#### plate    heat_no /          serials        │ │
│          LN-#### linear   supplier_batch_no  SR-####        │ │
│          (row-id code)    (NO code — row id  (row-id code)  │ │
│                            only)                             │ │
│  └────────┴────────────────┴─────────────────┴────────────┘ │
│      requires_heat_no / _mtc / _supplier_batch / _serial_no  │
│      (from the BOM line) — missing data blocks receiving     │
└──────────────────────────────┬────────────────────────────────┘
                                ▼
                RESERVE  (inventory_reservations — row id,
                           no code)  — scalar / batch only
                piece → reservePiece · serial → reserveSerial
                (serial: lib function exists, no UI/API route yet)
                                ▼
                MATERIAL ISSUE  (material_issues — row id, no code)
                optionally stamps job_card_id
                batch: inventory_batch_allocations bridges the issue
                to the specific batch(es), FIFO by receipt date
                already-issued line? → any further issue is
                audit-only, no second allocation (I11)
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                          PRODUCTION                           │
│  JOB CARD  jc_no = JC-####                                  │
│  one per project (or unit): the 33-stage boiler card or     │
│  the 16-stage APH card. Each stage: Start (fitter/welder),  │
│  Finish (Production sign), then QC sign.                    │
│  Material arrives through a MATERIAL INDENT that Stores     │
│  releases (-> Material Issue).                              │
│                                                             │
│  piece-tracked line? -- yes --> CUT                         │
│      stock_pieces parent_id lineage: used / remnant         │
│      (pending_receipt -> Stores confirms -> available)      │
│      / scrap                                                │
│  DISPATCH stage -> hand-over of finished subsystems to      │
│  Dispatch (they land on the draft packing list)             │
└───────────────┼────────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│                              QC                                │
│  QC DOCUMENT  doc_id  (e.g. SBH-1037-SF-WB-300-17)             │
│    ├── qc_document_parts → TEST CERTIFICATE                    │
│    │     (certificate_no — captured from a real cert, never    │
│    │      generated)                                           │
│    ├── qc_iiia_groups  (Form IIIA groups — row id, no          │
│    │      generated business code)                             │
│    └── heat / MTC / drawing revision carried through from       │
│          the piece / batch / serial above                       │
│                                                                 │
│  separate shop-floor quality trail:                            │
│    NCR  ncr_no = NCR-####  — against a Job Card or a piece     │
│    QC sign on each Job Card stage; inward review of every   │
│    receipt; pre-dispatch approval of each packing list      │
└─────────────────────────────────────────────────────────────┘`;

const DESIGN_ENGINEERING_DIAGRAM =
`RECEIVES:  a confirmed Sale Order → PROJECT  (project_no, SB-####)
               │
               ▼
        SCOPE OF SUPPLY  (released — the technical boundary of the order)
               │
      ┌────────┴────────┐
      ▼                 ▼
   DRAWING            CALC SHEET
   calc_drawings:     calc_sheets:
   name + revision    name
   (no generated       (no generated
    code — the          code)
    name IS the
    "drawing number")
      │                 │
      └────────┬────────┘
               ▼
        BOM LINE  (bom_items — plain row id, no code)
        via PMB import (bulk, the common path)
        or a raised Purchase Requisition (PR-####)
               │
        set material description, MOC, size/spec, section,
        and the 4 traceability flags:
          requires_heat_no · requires_mtc ·
          requires_supplier_batch · requires_serial_no
               │
        RELEASE BOM
        → snapshots drawing revision onto the BOM line
          (bom_items.drawing_revision_at_release) — a later
          drawing revision can never silently rewrite it
               │
               ▼
HANDS OFF TO PROCUREMENT: every open BOM line, each carrying
its own frozen drawing revision + traceability requirements.

TRACEABILITY PRESERVED: the drawing revision a part was actually
built against survives every later drawing change, because it
was copied onto the BOM line at the moment of release, not
looked up live.`;

const PROCUREMENT_DIAGRAM =
`RECEIVES:  an open BOM line (from Design's PMB import, or a
           Purchase Requisition raised by Eng/Design/Stores)
               │
               ▼
        purchase_status ladder on the BOM line:
        Enquiry → Comparison → Ordered → Transit → Received
        (Cancelled / In-Stock are the other closed states)
               │
      ┌────────┴────────┐
      ▼                 ▼
   supplier quotes    a Stores "Reserve from stock" badge
   recorded per         means Stores may already cover this
   requirement           line — check before sourcing it
      │
   select supplier
      ▼
   PURCHASE ORDER
   po_no = NNN/SB/YYYY-YY  (real business numbering, not a
                             plain nextNumber() sequence)
   one supplier per PO — every line on it must share one
      │
      ▼
HANDS OFF TO STORES: the PO reference travels with the delivery;
Stores' GRN/receipt step matches against it and the BOM line's
own traceability requirements (heat/MTC/batch/serial), which
Procurement never enters itself — only Stores captures the
physical evidence at receipt.

TRACEABILITY PRESERVED: po_no + the BOM line id are both on the
purchase_orders/bom_items rows, so a later receipt can always be
traced back to which PO and which requirement it satisfied.`;

const STORES_DIAGRAM =
`RECEIVES:  material arriving against a PO reference (or a
           direct/no-PO delivery), for a specific BOM line
               │
               ▼
        STOCK RECEIPT  (stock_receipts.inward_batch_no,
                         INW-####)  — supplier, PO, GRN ref,
                         received_at; one supplier per receipt
               │
        tracking_mode on the inventory line decides which
        sibling table this receipt materializes into:
               │
   ┌─────────┬─────────────────┬──────────────────┬──────────┐
   ▼         ▼                 ▼                    ▼         │
 scalar     PIECE             BATCH                SERIAL     │
 on_hand    stock_pieces      inventory_batches    inventory_ │
 (a plain   PL-#### plate     a decrementing qty   serials    │
  number)   LN-#### linear    POOL per lot —       SR-####    │
            weight always     heat_no /            one row    │
            computed from     supplier_batch_no    per        │
            dimensions,       — NO generated code,  physical  │
            never typed       identified by row id  unit      │
   └─────────┴─────────────────┴──────────────────┴──────────┘
               │
        VALIDATION — the receiving BOM line's own flags:
        requires_heat_no · requires_mtc ·
        requires_supplier_batch · requires_serial_no
               │
        missing required data  ──►  REJECT the receipt
               │  (data present)
               ▼
        stock is now on hand — available for
        RESERVE (scalar/batch, inventory_reservations) or
        MATERIAL ISSUE (direct FIFO, no prior reservation)
               │
HANDS OFF TO PRODUCTION: a Reserve → Issue creates the
MATERIAL ISSUE row Production's Job Card can link to
(job_card_id); a Cut against a piece is Production's own action
against stock this department received, not something Stores
does.

TRACEABILITY PRESERVED: heat_no / supplier_batch_no / serial_no
and the receipt row all stay attached to the physical batch or
serial through every later allocation or issue — a
material_issues row can always be traced back to the exact
batch(es)/serial it drew from (inventory_batch_allocations, or
inventory_serials.material_issue_id).`;

const PRODUCTION_DIAGRAM =
`RECEIVES:  material Stores has received and routed to Production
               │
               ▼
        MATERIAL INDENT  (Shop Floor → Material Indent)
        Production asks Stores for the routed lines; Stores
        releases them → MATERIAL ISSUE (stock moves to WIP)
               │
               ▼
        JOB CARD   jc_no = JC-####
        one per project or unit: the 33-stage boiler card or the
        16-stage APH card (Shop Floor → Job Card)
               │
        each stage:  Start (fitter / welder, start date)
                     → Finish (end date, Production sign)
                     → QC sign (QC → Job Cards)
               │
        piece-tracked plate / section?
               ▼
        CUT  (Shop Floor → Remnants → Cut)
        parent PL-#### → used / remnant / scrap
        a remnant waits for Stores to confirm it back into stock
               │
        HYDRAULIC TEST stage + a Hydro Test record with Pass
        → Hydro Test milestone completes
               │
        every stage of every job card finished and QC-signed
        → the twelve Production milestones complete together
               │
               ▼
        DISPATCH stage → hand-over (Shop Floor → Dispatch)
        finished subsystems go onto the project's draft packing
        list; Production answers "approved for dispatch?"

HANDS OFF TO: Dispatch (packing list), QC (stage signs,
pre-dispatch approval).

TRACEABILITY PRESERVED: the indent and issue say which material
went to which project or unit, and parent_id on a cut piece
keeps its heat number and certificate.`;

const QC_DIAGRAM =
`RECEIVES:  the project's BOM (material lines and bought-out
           fittings), test certificates from suppliers, and the
           approved drawings
               │
               ▼
        QC DOCUMENT  doc_id  (e.g. SBH-1037-SF-WB-300-17 —
                     a statutory boiler-document series, one per
                     boiler, not a generic sequence)
               │
      ┌────────┴────────────────────┐
      ▼                              ▼
  qc_document_parts               qc_iiia_groups
  one row per material line       Form IIIA per-sub-assembly
  (Form IV A, filled by           groups (e.g. "Feed pipeline")
   Sync from BOM)                  — row id, no generated code
      │                              │
      ▼                              │
  TEST CERTIFICATE                   │
  certificate_no — captured from     │
  a real supplier/mill cert PDF,     │
  never generated by this app        │
      │                              │
      └──────────────┬───────────────┘
                      ▼
        PDF gate: every part must be linked to a certificate
        before the statutory PDF can be generated — an
        unlinked part blocks it, not a soft warning

        separately, shop-floor quality (not the statutory
        document above):
          NCR  ncr_no = NCR-####  — raised against a Job Card
          or a stock piece; disposition (Rework/Repair/Scrap/
          Use-as-is) drives the next action
          Job Cards — QC signs each finished stage
          Approvals — inward review of every receipt, and
          pre-dispatch approval of each packing list

HANDS OFF TO: Dispatch (a packing list can only be dispatched
after QC and Production approve it); the customer portal (QC can
share a finished document with the customer).

TRACEABILITY PRESERVED: this is the terminus of the chain — a QC
document's parts resolve back through test_certificates to the
original heat/cast, and through qc_document_parts/qc_iiia_groups
to the exact BOM lines and drawing revision they were built
against.`;

// One feature per department: the shared end-to-end map (identical everywhere, so any two
// departments can compare the same picture) plus that department's own focused slice. Built as a
// raw object, same shape the grouped 'notifications' entries already use — GuideBody only needs
// key/label/icon/body/diagram/value/outcome/checklist/watchOut, not the feature() wrapper.
function architectureFeature(deptName, deptDiagram) {
  const divider = '═'.repeat(65);
  return {
    key: 'architecture', label: 'System Architecture', icon: GitCompareIcon,
    body: [
      `This page has two parts: the same end-to-end material-traceability map every department sees — so you can follow a part into or out of ${deptName} — and a focused diagram of what ${deptName} itself receives, creates, and hands off.`,
      'An ID shown as a real code (e.g. JC-####, PR-####) is generated by the app. Anything marked "no generated code" is identified only by its own free-text name or a plain database row id — do not expect a code for it anywhere else in the app.',
    ],
    diagram: `${END_TO_END_TRACEABILITY_DIAGRAM}\n\n\n${divider}\n${deptName.toUpperCase()} — YOUR SLICE OF THE SAME SYSTEM\n${divider}\n\n${deptDiagram}`,
    value: 'One system, one material trail — every department\'s records point at the same underlying Project/BOM/Batch/Serial/Piece identity, just entered and read from a different screen.',
    outcome: 'You can point at any record in your own workspace and know exactly which upstream record produced it and which downstream record consumes it next.',
    checklist: [
      'Use this page to answer "where did this material actually come from" or "what happens to this after I hand it off" — not as a data-entry screen.',
      'Treat "no generated code" literally — do not go looking for a Drawing ID, BOM Item code, Reservation code, or Material Issue code elsewhere; none exists.',
    ],
    watchOut: 'This diagram reflects the app as actually built and verified against the real schema and routes, not an idealized or planned architecture. If your screen ever shows something this diagram doesn\'t, trust the screen and flag the diagram for correction.',
  };
}

// Milestone Tracker (2026-08-17) — most milestones now complete themselves off a real event
// instead of waiting for someone to open the status drawer (lib/milestone-auto.js is the single
// source of truth this table mirrors). Shared shape so every manufacturing department's guide
// renders the same table via GuideBody's existing `table` field — no new renderer needed.
function milestoneTrackerFeature(rows) {
  return feature('milestone-tracker', 'Milestone Tracker', Clock3Icon, [
    'Milestones are the steps on the project page\'s Milestone Tracker. Most of yours start and complete by themselves when the real work happens; the table says what triggers each one.',
    '"Explicit action" means a person closes it with a named button. Any milestone can still be started or closed by hand from its card on the project page (late closes ask for a reason), and another department can send a closed milestone back with Raise → Send back.',
    'When the last milestone of your department closes, the next department is alerted. Milestones never reopen by themselves. A manager can switch automatic start or completion off per milestone in Settings → Milestone Automation.',
  ], {
    table: { columns: ['Milestone', 'Trigger', 'How it completes'], rows },
  });
}

const FEATURE_FOUNDATIONS = {
  scope: {
    value: 'The Scope of Supply is the shared boundary of the order. It protects the team from designing, buying, or promising something that was never agreed with the customer.',
    outcome: 'Design and Engineering can start with the same understanding of what is included, excluded, and dependent on the customer.',
    checklist: ['Read the commercial order and customer assumptions.', 'Separate included work, exclusions, and customer responsibilities.', 'Raise an unclear point as a task before releasing technical work.'],
    watchOut: 'Do not use an email or memory as the final scope. If the scope changes, update the record and leave a visible reason.',
  },
  calc: {
    value: 'Calculation Sheets turn engineering rules and project inputs into a repeatable technical result. They make the decision explainable and allow a later reviewer to reproduce it.',
    outcome: 'The result has passed validations, has a saved snapshot or revision reference, and can be understood without asking the original author to recreate it.',
    checklist: ['Confirm the project and revision before entering inputs.', 'Resolve validation warnings instead of ignoring them.', 'Save a snapshot with a meaningful note when the result is ready for review.'],
    watchOut: 'A number on screen is not automatically a released calculation. Keep inputs, formula version, warnings, and snapshot history together.',
  },
  drawings: {
    value: "The drawing record ties each file to its project, the person responsible for it and its approval. It stops Production building from an old or unapproved file.",
    outcome: "Every drawing has a type, an assignee and a file, and shows who approved it, so other teams can tell which drawing is approved for use.",
    checklist: ["Give the drawing a clear title and pick its type.", "Upload the file before Submit for review; submitting with no file is refused.", "The Design Head approves or sends it back. Nobody approves their own work."],
    watchOut: "Uploading a newer file does not approve it. If an approved drawing changes, the Design Head un-approves it and approves it again.",
  },
  bom: {
    value: "The BOM is the material contract between technical design and execution. It tells Procurement what to source and gives Stores, Production, QC, and Dispatch a common item identity.",
    outcome: "Every required line has a usable description, specification, quantity, category and place in the BOM tree.",
    checklist: ["Preview imports before confirming them.", "Check description, MOC, size/specification, make, quantity, section, and group.", "Link a line to its Item Master entry if the import missed it: click the not linked to catalog tile at the top of the BOM.", "Leave Procurement, Stores, and Production-owned fields to those teams."],
    watchOut: "Do not fix a technical mistake by creating a duplicate line. Correct the source line and review the impact on quotes, receipts, and packing. A line that already has a receipt or issue against it can not be re-linked to a different catalog item; that protection is intentional.",
  },
  bomStructure: {
    value: 'The BOM workspace is a two-pane tree-and-detail editor, not just a viewer: build System → Subsystem → Assembly → Sub-assembly → Component structure (any label works — the levels are a naming convention, not a database rule) so a boiler’s "2 ID Fans, each with 1 Drive sub-assembly" is a real structure the system can roll up, then work each node’s Items, Drawings, and History from one place instead of hunting across the project page.',
    outcome: 'Every node shows its own local quantity multiplier and a live roll-up quantity computed through the whole chain beneath it, plus its linked drawings, and a Release Readiness strip (item / drawing-linked / unassigned / pending-ECN counts) that stays purely informational — release is still the one existing Release BOM action, reachable from here or from Requests. Calculation sheets link to a project’s Drawings from Calc Sheets → Calc Links instead — a calc sheet substantiates a drawing, not a structural tree node.',
    checklist: [
      'Build the tree first — rename, reorder with Move Up/Down, or Move to… a different parent. A cycle (moving a node under its own descendant) is rejected automatically.',
      'Add items to a node either by creating a new BOM line inline (same fields/validation as the project-page table) or by assigning an existing unassigned item to it — both write the same BOM item record.',
      'Link a Drawing from the node’s own tab. The drawing picker defaults to Approved/As-built only — turn on "Show all statuses" to pre-link a drawing still in progress, which stays visibly flagged "Under review — not yet approved" until it clears.',
      'Duplicate a node to reuse a proven sub-structure on the same project — items clone as fresh, independent rows, but linked drawings do not carry over; re-link whatever actually applies to the copy.',
    ],
    watchOut: 'A BOM item left unassigned (no node) still works exactly as before — assigning it to the tree is optional, not a requirement. Deleting a node never deletes its items; they fall back to Unassigned. And nothing here forces a change through an ECN — inline edits still save immediately, same as always.',
  },
  bomConfiguration: {
    value: 'A fan, pump or boiler system has a datasheet: type, flow, static head, speed, motor rating. These are facts about the system, not things to buy. Keeping them as "items" made the BOM look bigger than it is, forced you to categorise them, and could even send them to Procurement as material to source. Configuration gives them their own place on the system itself.',
    outcome: 'Each system or subsystem carries its own datasheet on its Overview tab. Datasheet rows in a PMB import are recognised automatically and saved there, so the BOM item list only holds real things to buy.',
    checklist: [
      'At import, look at the “Configuration” list in the preview. If a row is really something to buy, tick “Treat as item” next to it.',
      'Open a system or subsystem → Overview → Configuration to add, edit, reorder or remove rows, then click Save. Put units inside the text (for example “FLOW cfm” = “2400”).',
      'If an older import left datasheet rows in the item list, the node shows a yellow note “items look like datasheet fields”. Click Review & convert, tick what to move, and confirm.',
      'Templates, Duplicate and the Final BOM card and PDF all carry the configuration along with the node.',
    ],
    watchOut: 'Only clear datasheet rows are moved automatically: a row with a quantity, a material, or PR/PO/receipt data stays an item (for example a motor line that names a make and a PO). Converting old items deletes those item rows, so it only works before the BOM is released and never on lines that already have orders or receipts.',
  },
  structureTemplates: {
    value: 'Building the same structure again for every boiler is slow and easy to get wrong. A Structure Template lets you build it once, fix it in one place, and reuse it. Every project still gets its own independent copy, so a template can never disturb an order that is already running.',
    outcome: 'A new project’s BOM starts from a saved template instead of a blank page, you know which version each part was built from, and you can see which projects used a template before you rename, update, or remove it.',
    checklist: [
      'Save a template only from a BOM you are happy with. Check the names, quantities, and items first.',
      'Give it a clear name and model (for example “SF-500 Complete Package”) so the next person can find it.',
      'After applying a template, look over the lines it added. Sizes and quantities may need adjusting for this particular order.',
      'Before updating or removing a template, click “Used on…” to see which projects used it. None of them will change, but you should know who is affected.',
      'Put loose (unassigned) items onto a node before saving. Only items on a node are saved into a template.',
    ],
    watchOut: 'A template is a copy, not a live link. Updating, renaming, or deleting a template never changes a BOM that already used it, and a newer version is only a hint, never an automatic change. There is no undo for an update: the old content is not kept. To be safe, check the before-and-after counts the dialog shows.',
  },
  whereUsed: {
    value: 'Where-Used answers "if I change this part, what else does it affect?" across every project at once — the question a flat, per-project BOM can never answer on its own.',
    outcome: 'A search returns every project, and the assembly within it, that carries a matching part — grouped by real identity (the catalog item when the line was picked from search) or by normalized description/MOC/size when it was typed or bulk-imported.',
    checklist: ['Search by description; the match is case- and spacing-insensitive.', 'Treat a catalog-linked result and a free-typed result as potentially the same part even if they never grouped together — they only merge automatically once both carry the same catalog item.'],
    watchOut: 'Most real BOM lines arrive by bulk PMB import, which never sets a catalog link — so two truly identical parts can still show as separate rows if their free text differs even slightly (extra space, different capitalization is fine; a genuinely different spec string is not).',
  },
  commonUncommon: {
    value: 'Common/Uncommon tells you which parts are worth stocking proactively (reused across many projects) versus which are one-off buys — a judgment call Procurement and Stores previously had to make from memory.',
    outcome: 'Every part in the system is classified Common (used on 2 or more projects) or Uncommon (used on exactly one), with a project count and list.',
    checklist: ['Use Common parts as candidates for minimum-stock levels or auto-indent suggestions.', 'Don’t treat Uncommon as "unimportant" — it just means no reuse signal exists yet, not that the part is disposable.'],
    watchOut: 'Same identity-matching ceiling as Where-Used: classification is only as good as how consistently a part’s description/MOC/size was entered, unless it was picked from the catalog.',
  },
  ecn: {
    value: 'An Engineering Change Note is the difference between "someone quietly edited a BOM field" and a real, accountable change: who asked, why, what the old and new values were, and who approved it — the release/approval workflow this module never had before.',
    outcome: 'A change has a reason on record, a Head’s explicit approval before it takes effect, the release revision it became effective at, and a visible list of every PO, packing line, task, and drawing the changed item touches.',
    checklist: ['Raise the ECN with the actual field, old value, new value, and a real business reason — not just "spec update".', 'Check the downstream-impact list before approving — a change to an item already on an issued PO or a packing list needs those teams told separately.', 'Only a department Head can approve or reject — raising one is open to any Engineering member.'],
    watchOut: 'Approving an ECN updates the BOM field it named, but does not yet block other, non-ECN edits to that same field — it is a logged approval trail, not (yet) a hard gate on every BOM edit.',
  },
  tasks: {
    value: 'Tasks convert a vague follow-up into an owned action with a due date and history. They are the system’s memory for work that does not deserve a full milestone.',
    outcome: 'A person or department knows exactly what to do, by when, and what evidence closes the action.',
    checklist: ['Write the action as a verb, not only a topic.', 'Choose the correct department, person, project, and due date.', 'Close the task only after the action or response is actually complete.'],
    watchOut: 'Do not use a private note or chat message for a dependency that can delay another team. Raise a task so it remains visible.',
  },
  requests: {
    value: "A purchase request gives a new material need a traceable path to Procurement, with the project, quantity and specification attached.",
    outcome: "Procurement can source the item without asking again for the project, quantity, size or material.",
    checklist: ["Pick the item from the Item Master where it exists.", "Fill the quantity, MOC and size of every line, and pick the project or No project.", "Open PR History afterwards to see the request and its status."],
    watchOut: "Do not raise a second request because the first one is missing information. Edit the first one from PR History (pencil icon).",
  },
  milestones: {
    value: "Milestones show the major handoffs in an order's lifecycle. They turn project progress into dates and ownership that Management and the customer can rely on.",
    outcome: "The milestone has an honest status, actual dates, a delay reason when needed, and a visible next action for the receiving team.",
    checklist: ["Most milestones start and finish by themselves from real events; see the Milestone Tracker page for which.", "For the few closed by hand, record the actual end date only when the deliverable is complete.", "Use stages or tasks for remaining follow-up instead of hiding unfinished work."],
    watchOut: "Closing a milestone to remove it from an attention list makes the project look healthier while losing the real blocker.",
  },
  enquiry: {
    value: "The Enquiry tab is where every material need waits until suppliers have quoted. It makes sure each item is understood before supplier conversations begin.",
    outcome: "Each line has a clear source, project, usable specification, and at least one supplier quote moving it to Selection.",
    checklist: ["Check the description, size and quantity before asking suppliers.", "Send one RFQ to several suppliers instead of collecting prices one by one.", "Raise a task to the requesting department when information is missing."],
    watchOut: "A cheap quote for the wrong specification is not progress. Resolve the technical identity before comparing prices.",
  },
  quotes: {
    value: 'Quote records preserve the commercial evidence behind a supplier decision. They make comparisons fair and allow someone else to understand why a quote won or lost.',
    outcome: 'Comparable suppliers, units, prices, terms, validity, and notes are recorded before selection.',
    checklist: ['Record one quote per supplier and requirement.', 'Normalize units, taxes, freight, payment terms, and validity where possible.', 'Keep unsuccessful quotes as history.'],
    watchOut: 'Deleting the losing quote removes the reasoning trail. A comparison is valuable even when only one supplier is eventually selected.',
  },
  supplier: {
    value: 'Supplier selection converts a comparison into a controlled sourcing decision. It is the point where technical suitability and commercial value become a purchase basis.',
    outcome: 'The selected quote is technically acceptable, commercially understood, and ready to flow into a correct draft PO.',
    checklist: ['Check the selected supplier against the requirement, not only the lowest rate.', 'Confirm validity, payment, delivery, and technical notes.', 'Leave a reason when the selected quote is not the cheapest.'],
    watchOut: 'Changing a supplier after selection without updating the quote or note creates a PO that cannot be explained later.',
  },
  po: {
    value: "A Purchase Order is the formal commitment to the supplier. It turns an internal requirement into clear quantities, rates, terms, and delivery expectations.",
    outcome: "The issued PO matches the selected quote and BOM requirement, and Stores can later match the delivery to it.",
    checklist: ["Review supplier, lines, quantities, rates, terms, and delivery details.", "Check the PDF before sending it.", "Use Cancel Issue (back to draft) or Cancel PO only for a real correction."],
    watchOut: "Issuing a PO with the wrong quantity or unit is more expensive than spending another minute on the draft.",
  },
  status: {
    value: "Status gives every department a shared answer to where an item is now: Enquiry, Comparison, Ordered, Transit, Received, Cancelled or In-Stock.",
    outcome: "The visible stage reflects the real sourcing situation and carries the PR and PO references the next team needs.",
    checklist: ["Read the item's quotes and PO, not just the status label.", "Let the app move the status: quotes, selection, PO issue, supplier dispatch and Stores' receipt each move it.", "Change a status by hand only to correct a real mistake."],
    watchOut: "Received is set when Stores receives the material at Inward. Setting it by hand hides a delivery that has not arrived.",
  },
  purchaseReturns: {
    value: 'Purchase Returns is the record of material sent back to a supplier — wrong spec, damage on receipt, over-supply — the Procurement-side mirror of Sales Returns.',
    outcome: 'Every return has an inspection outcome (pending/accepted/rejected), a stock action once accepted (removed from stock, or replaced with no stock change), and a debit-note reference for the credit trail.',
    checklist: ['Raise the return against the actual issuing PO.', 'Only remove stock once inspection is Accepted and you’ve picked the real inventory item — that decrement only fires once, even if you edit the row again later.', 'Record the debit note reference once the supplier confirms it.'],
    watchOut: 'A return sitting at Pending inspection has not adjusted stock at all — do not assume material is already off the books until Accepted + a stock action is set.',
  },
  inventory: {
    value: 'Inventory is the cross-project view of physical stock. It prevents the team from promising the same material twice and separates on-hand quantity from committed quantity.',
    outcome: 'On-hand, reserved, and available quantities agree with the physical store and active project commitments.',
    checklist: ['Search by a consistent item name and unit.', 'Check available quantity after reservations.', 'Use reservations and issues to explain movements instead of editing totals casually.'],
    watchOut: 'Two slightly different item names can split one physical stock balance into two misleading records.',
  },
  reserve: {
    value: 'Reservations make a stock promise visible without pretending the material has already left Stores. They protect a project’s supply while keeping physical stock honest.',
    outcome: 'The required quantity is reserved against the correct project and can no longer be promised to another project accidentally.',
    checklist: ['Confirm the project BOM line and required unit.', 'Reserve only the quantity actually committed.', 'Release or adjust the reservation when the requirement changes.'],
    watchOut: 'A reservation is not an issue. Do not treat reserved material as consumed or physically delivered.',
  },
  receipt: {
    value: "A receipt records what physically arrived, not what was ordered. It lets Stores, QC and Production see the remaining balance and find the supporting GRN or certificate.",
    outcome: "Quantity received so far, GRN reference, and any heat, batch, serial or certificate details the line requires are recorded.",
    checklist: ["Match the delivery to the PO line.", "Enter the quantity that actually arrived; a part delivery is fine.", "Fill the traceability fields the line asks for."],
    watchOut: "Do not enter the ordered total when only part arrived. The line stays open until the full quantity is in.",
  },
  remnant: {
    value: 'Cutting & Remnant Matching turns a leftover plate or section offcut into real, reusable stock instead of scrap. The moment a BOM releases, the system checks it against what is actually sitting in Stores and reserves a fit automatically — nobody has to remember to go looking.',
    outcome: 'A BOM line a remnant can cover never reaches Procurement. The piece it used stays traceable from purchase through every cut, all the way to scrap, and its weight is always computed from its dimensions — never guessed or hand-typed.',
    checklist: [
      'This only works on a BOM line with a Category (Plate / MS Section / Angle), MOC, and numeric dimensions filled in.',
      'A matched line needs no action from you — the system already found and reserved the fit.',
      'A line with no Category or blank dimensions is invisible to matching, not an error — it simply goes to Procurement exactly as before.',
    ],
    watchOut: 'Do not assume every plate/section line got checked. Only lines entered with Category + dimensions filled in are ever matched — free-text-only lines (most bulk-imported BOMs) are skipped silently.',
  },
  sas: {
    value: 'In-Stock and Sold-As-Such flows let the business source and use material that is not tied to a normal customer project without inventing a fake project history.',
    outcome: 'The material’s source, status, and eventual movement remain traceable even outside a standard project milestone chain.',
    checklist: ['Confirm whether the item is stock or Sold-As-Such demand.', 'Keep the source and status consistent through sourcing and issue.', 'Use the correct inventory movement when the item is consumed.'],
    watchOut: 'Do not attach stock demand to an unrelated customer project just to make a screen accept it.',
  },
  workers: {
    value: "The Workers tab captures shop-floor people who do not need application accounts. It gives Production a reliable daily view of attendance and where work happened.",
    outcome: "Attendance and assignment data can support planning, payroll review, and project history without creating unnecessary logins.",
    checklist: ["Choose the exact date before marking attendance.", "Record present, half-day, or absent accurately.", "Add project and work assignment while the day is still known."],
    watchOut: "Do not delete a historical worker. Deactivate the person so earlier attendance remains understandable.",
  },
  handoff: {
    value: 'Handoffs prevent one department’s completion from becoming another department’s surprise. They connect the action, owner, and evidence across the order lifecycle.',
    outcome: 'The receiving department sees a clear task or notification with enough context to act without restarting the conversation.',
    checklist: ['Name the receiving department or person.', 'Include the project, item, date, and dependency.', 'Confirm the response before closing the handoff.'],
    watchOut: 'A notification is a signal, not proof of completion. Keep the actual result in the relevant record or task.',
  },
  jobcards: {
    value: "A Job Card is the shop-floor record of one boiler or air pre-heater job: every production stage with its dates, fitter/welder, Production sign and QC sign, laid out like the paper job card.",
    outcome: "Each stage shows when it started and finished, who did it, and whether QC has signed it, so anyone can see how far the job is.",
    checklist: ["Create one card per job against the right project (or unit of a split order).", "Pick the fitter/welder, then Start a stage when work begins and Finish it when it ends.", "Do not back-fill a week of stages in one go; dates are stamped when you click."],
    watchOut: "Finish is Production's sign. QC signs separately; a stage QC sends back has to be redone and finished again.",
  },
  tests: {
    value: 'Test records make quality decisions auditable. They preserve what was tested, when, by whom, against which reference, and with what result.',
    outcome: 'A reviewer can understand the result and the next action without searching through private files or messages.',
    checklist: ['Choose the correct project and test type.', 'Record reference, inspector, date, result, and useful notes.', 'Use Pending until the inspection is genuinely complete.'],
    watchOut: 'A Pass without a reference or tested date is not useful evidence. A Fail without a reason cannot drive rework.',
  },
  certificates: {
    value: 'The certificate bank prevents repeated entry of the same material evidence and links a document to the project or part where it matters.',
    outcome: 'The certificate number, material identity, maker/cast/plate details, and PDF can be found by the next reviewer.',
    checklist: ['Check the certificate number and material identity.', 'Upload the evidence when available.', 'Link it to the relevant project or part.'],
    watchOut: 'Do not attach a certificate only because the description looks similar. Verify the actual material and heat/plate identity.',
  },
  statutory: {
    value: 'Statutory documents turn inspection and design data into formal evidence. Keeping header data and part rows together makes the generated PDF defensible.',
    outcome: 'Required fields are complete, the saved record matches the PDF, and the document is ready for the intended review or submission.',
    checklist: ['Complete company, customer, project, and equipment details.', 'Check every part row and reference.', 'Link each part to its BOM line first if you want a certificate suggestion — an unlinked part never gets one, by design.', 'Generate and inspect the PDF before treating it as final.'],
    watchOut: 'Do not advance an incomplete statutory record just because a PDF can be generated. A suggested certificate is a nudge, never a substitute for checking the material spec yourself — pick the right one even when a suggestion is showing.',
  },
  board: {
    value: 'The packing board gives Dispatch one place to see what is still being prepared, what is ready, and what has already left the site.',
    outcome: 'Every list has one understandable status and an owner for the next physical or documentary action.',
    checklist: ['Start from the correct project and order.', 'Keep Draft, Ready, and Dispatched status truthful.', 'Check for an existing list before creating another one.'],
    watchOut: 'A Ready list is an approval to release, not a suggestion. Do not move it forward before the contents and header are checked.',
  },
  generate: {
    value: "Building the packing list from the BOM avoids re-typing and keeps the link between what Engineering defined and what Dispatch packs.",
    outcome: "Every ready line is on a packing list, and the list can be reconciled back to the BOM.",
    checklist: ["Start from Pending Items; it shows only lines that are ready to pack.", "Add new ready lines to the project's open draft list unless a separate shipment is really needed.", "Check the draft before adding package details."],
    watchOut: "A packed or dispatched list is never changed by adding lines. New lines go to the open draft or to a new list.",
  },
  packing: {
    value: 'Packing details turn a material requirement into a physical package record. They help the shop and customer identify what is inside each box or package.',
    outcome: 'Package identity, quantity, unit, specification, and scanned or physically checked quantity are recorded clearly.',
    checklist: ['Use the BOM link and correct package number.', 'Enter actual packed/scanned quantity and unit.', 'Reconcile the physical count before Ready status.'],
    watchOut: 'Never silently exceed the BOM quantity. Explain an overage, split, or correction in the record.',
  },
  pdf: {
    value: 'The packing PDF is the durable delivery document. It communicates the final packed contents and header details outside the application.',
    outcome: 'The PDF matches the approved list, customer/address, invoice or DC, vehicle, and dispatch method.',
    checklist: ['Finish the list header before generating.', 'Check the PDF visually for missing or wrong details.', 'Keep the document with the customer/order record.'],
    watchOut: 'A generated PDF is not automatically correct. Always inspect the document after the last edit.',
  },
  reconcile: {
    value: 'BOM reconciliation explains the difference between what was defined, what was packed, and what remains. It protects against partial dispatches becoming invisible shortages.',
    outcome: 'Each packing line can be traced to a BOM line and the remaining quantity is understandable.',
    checklist: ['Use the BOM link for every carried line.', 'Check packed and pending quantities after partial dispatch.', 'Create a task for an intentional substitution or unresolved balance.'],
    watchOut: 'Do not close the story by editing quantities until the numbers look tidy. Preserve the reason for a difference.',
  },
  progress: {
    value: 'Customer progress is read from project milestones, so accurate internal dates reduce customer uncertainty without creating a separate reporting process.',
    outcome: 'The customer view reflects the actual project position and does not promise a milestone that the internal record has not reached.',
    checklist: ['Keep planned and actual dates current.', 'Record delay reasons when dates move.', 'Check the customer-facing view after important milestone changes.'],
    watchOut: 'Do not close a milestone merely to improve the customer view. Honest delay information is more useful than false progress.',
  },
  leads: {
    value: "An enquiry captures demand from first contact to won or lost. Good enquiry data tells the team who asked, what they need, where they came from, and who follows up.",
    outcome: "The enquiry has an owner, source, products, a stage and a next follow-up date.",
    checklist: ["Capture the organization and contact details.", "Add the products asked about and the A/C Manager.", "Log each call in the Diary with the next plan date."],
    watchOut: "Do not create a second enquiry for the same requirement. Open the existing one and move its stage.",
  },
  pipeline: {
    value: 'Pipeline shows the active commercial conversation after qualification. It helps Sales and Marketing focus time on real opportunities and gives Management a forecast grounded in current stages.',
    outcome: 'Each opportunity has a credible stage, value, probability, expected close, next contact, and lost reason where applicable.',
    checklist: ['Move the opportunity when the customer conversation changes.', 'Keep the next contact and expected close realistic.', 'Close won or lost work instead of leaving it open indefinitely.'],
    watchOut: 'An old stage or optimistic close date makes every report less useful. Update the record after meaningful contact.',
  },
  customers: {
    value: 'Customer and contact records prevent the same commercial party from being typed differently across quotations, orders, and projects.',
    outcome: 'The right legal/customer identity, people, address, and contact history are available for the next quotation or order.',
    checklist: ['Search before creating a new customer.', 'Keep address and primary contact current.', 'Reuse the record in quotations and Sale Orders.'],
    watchOut: 'Near-duplicate customer records split history and can send documents to the wrong address.',
  },
  quotations: {
    value: 'Quotations turn a commercial proposal into a structured, reviewable document. They preserve the exact lines, rates, terms, and customer identity that were offered.',
    outcome: 'The PDF is accurate and an accepted quotation can flow cleanly into a Sale Order without retyping the proposal.',
    checklist: ['Use the correct customer and address.', 'Check line items, quantities, rates, taxes, and terms.', 'Generate the PDF and record the acceptance outcome.'],
    watchOut: 'Do not convert an unreviewed quotation. A wrong quotation becomes a wrong order and a wrong project scope.',
  },
  'sale-orders': {
    value: "The Sale Order is the confirmed commercial handoff into execution. It gives Design an agreed basis for the Scope of Supply and the project.",
    outcome: "Customer, address, order lines and commercial references agree before technical work begins.",
    checklist: ["Confirm the accepted quotation and customer identity.", "Check order lines, quantities, terms, and delivery expectations.", "Attach the Order Acknowledgement PDF so Design can carry it onto the project."],
    watchOut: "Do not treat a draft or verbal acceptance as a confirmed Sale Order. Design creates the project from the order, so the order must be right.",
  },
  reports: {
    value: 'Reports turn the quality of CRM data into decisions about pipeline, sources, departments, and campaigns. They are useful only when the records beneath them are maintained.',
    outcome: 'The team can explain the numbers, the date range, and the source fields behind the result.',
    checklist: ['Choose the correct report and date/filter context.', 'Investigate missing source, campaign, or stage data.', 'Use the result to assign an action, not only to observe it.', 'Use the Excel button next to PDF on any catalog report when the numbers need to go into a spreadsheet — it writes real numbers, not formatted text, so sums and sorts work in Excel.'],
    watchOut: 'Do not present a report as truth while key attribution or stage fields are blank.',
  },
  campaigns: {
    value: 'Campaigns connect marketing activity to the enquiries and opportunities it produces. They allow the team to invest more confidently in channels that create useful demand.',
    outcome: 'Every related lead uses a consistent campaign and the resulting volume and value can be reviewed later.',
    checklist: ['Create a clear campaign name and purpose.', 'Use the same campaign value on related leads and opportunities.', 'Review response and opportunity quality, not only lead count.'],
    watchOut: 'Inconsistent campaign names split one campaign across reports and make performance comparisons unreliable.',
  },
  team: {
    value: 'Assignment rules make ownership predictable as enquiry volume grows. They reduce missed follow-ups while still allowing deliberate manual assignment when needed.',
    outcome: 'The right department members receive work and everyone understands whether assignment is automatic or manual.',
    checklist: ['Keep only active, appropriate people in the rota.', 'Confirm the rule’s order or round-robin behavior.', 'Review assignment after changing department access.'],
    watchOut: 'Do not leave inactive people in an assignment list; leads can appear owned while no one can act.',
  },
  employees: {
    value: 'The employee record is the source for HR workflows, access context, payroll inputs, and department ownership. Keeping it accurate prevents errors across several modules.',
    outcome: 'Department, designation, manager, contact, joining, and employment status are current and consistent.',
    checklist: ['Search for an existing employee before creating one.', 'Check department and designation against the access needed.', 'Use separation/deactivation rather than deleting history.'],
    watchOut: 'Changing a department or status without checking access and open workflows can leave work assigned to the wrong team.',
  },
  onboarding: {
    value: 'Onboarding turns joining a person into visible tasks and evidence. It makes responsibilities clear for HR, the manager, and the employee’s department.',
    outcome: 'Required documents, induction, equipment, approvals, and access tasks have owners and completion evidence.',
    checklist: ['Confirm employee, department, designation, and start date.', 'Assign every required onboarding task.', 'Review incomplete tasks before marking onboarding complete.'],
    watchOut: 'Do not mark a task complete because it was requested. Completion should mean the evidence or action is actually done.',
  },
  attendance: {
    value: 'Attendance and shifts provide the date-specific record needed for workforce planning and payroll review. They should describe what happened on a day, not a permanent label on a person.',
    outcome: 'The correct employee, date, shift, and attendance status are recorded with a reason for any correction.',
    checklist: ['Select the exact date and shift.', 'Check the employee before saving a correction.', 'Add a clear reason when changing an existing entry.'],
    watchOut: 'A correction on the wrong date can quietly distort payroll and attendance history.',
  },
  leave: {
    value: 'Leave workflows protect staffing plans and employee balances. They give the manager and HR a shared record of the request, decision, and remaining entitlement.',
    outcome: 'Dates, balance, holiday overlap, approver, and final status are clear.',
    checklist: ['Check allocation and holiday/overlap before deciding.', 'Use approve, reject, or cancel deliberately.', 'Keep the request history after the decision.'],
    watchOut: 'Do not approve based only on the request comment; check the balance and team coverage.',
  },
  payroll: {
    value: 'Payroll brings salary structures, assignments, additions, loans, advances, and statutory settings into one controlled calculation.',
    outcome: 'The run has been reviewed before slips are generated, and the totals can be traced to the inputs used.',
    checklist: ['Check active salary assignments and additions.', 'Review loans, advances, and statutory rates.', 'Inspect totals before generating salary slips.'],
    watchOut: 'Do not correct a payroll total by changing an unrelated master record without understanding which future runs it affects.',
  },
  expenses: {
    value: 'Expenses, advances, and separation records keep employee money and exit obligations visible. They stop important financial actions from living only in email or spreadsheets.',
    outcome: 'The claim or settlement has supporting details, an accountable status, and a clear final action.',
    checklist: ['Check employee, date, amount, and supporting detail.', 'Complete approval and settlement steps in order.', 'Review separation tasks before deactivating the employee.'],
    watchOut: 'Do not close an employee record while an advance, loan, expense, or settlement task is unresolved.',
  },
  issues: {
    value: "On Floor is the record of what physically left Stores for the shop floor, with a date and a name.",
    outcome: "Anyone looking at a project later can see what left Stores, when, how much, and who logged it.",
    checklist: ["Pick the real project and BOM item, not a close-sounding one.", "Log the quantity that actually moved, not the full requirement.", "Log it close to when it happened."],
    watchOut: "Material released against a Production indent is recorded by the indent itself. Use Log issue here only for material that leaves outside an indent.",
  },
};

const feature = (key, label, icon, body, extra = {}) => {
  const foundation = FEATURE_FOUNDATIONS[key] || {
    value: `${label} gives the team a controlled place to complete and understand this part of the work.`,
    outcome: `The ${label.toLowerCase()} record is complete, current, and ready for the next person or department.`,
    checklist: [
      `Open the correct project or record before working on ${label.toLowerCase()}.`,
      'Check the important fields and supporting information before saving.',
      'Leave a clear status, note, or next action so the next person knows what happens now.',
    ],
    watchOut: 'If something is unclear, keep the uncertainty visible with a note or task instead of silently guessing or overwriting history.',
  };
  return { key, label, icon, body, ...foundation, ...extra };
};

// How-To entries stay short in the data source so they are easy to maintain, then receive the
// same learning scaffolding in every department: why the step matters and what to verify before
// moving on. The original step body remains the department-specific instruction.
const HOW_TO_NOTES = [
  {
    why: guide => `Starting in the correct ${guide.title} record gives the rest of the workflow the right project, owner, and context.`,
    verify: 'The correct project, order, employee, or date is visible before you change anything.',
  },
  {
    why: () => 'Doing the main work carefully creates the reliable input that the next step depends on.',
    verify: 'Required fields are complete and warnings or missing information have been handled.',
  },
  {
    why: () => 'Recording the result in the system prevents re-entry and gives the next department evidence they can trust.',
    verify: 'The result, reference, quantity, date, or document is saved in the record—not only in a message.',
  },
  {
    why: () => 'This step makes exceptions and dependencies visible while there is still time to resolve them.',
    verify: 'Any blocker has an owner and next action; a clean handoff has a clear receiving department or person.',
  },
  {
    why: () => 'Closing the workflow with an honest status keeps dashboards, reports, and downstream teams aligned.',
    verify: 'The final status and actual date are correct, and no unfinished work is hidden by closing early.',
  },
];

// The positional HOW_TO_NOTES fallback only makes sense against a single flat sequence — a topic
// inside howToGroups (§ Production's Work Orders/Job Cards split) is its own short sequence, not a
// slice of one big department-wide chain, so it always carries its own explicit why/verify instead
// of borrowing this array by index.
function enrichSteps(steps, guide) {
  return steps.map((step, index) => ({
    ...step,
    why: step.why || HOW_TO_NOTES[index]?.why(guide),
    verify: step.verify || HOW_TO_NOTES[index]?.verify,
  }));
}

function enrichHowTo() {
  for (const guide of Object.values(DEPARTMENT_HELP)) {
    if (guide.howToGroups) {
      guide.howToGroups = guide.howToGroups.map(topic => ({ ...topic, steps: enrichSteps(topic.steps, guide) }));
    } else {
      guide.howTo = enrichSteps(guide.howTo, guide);
    }
  }
}

export const DEPARTMENT_HELP = {
  Design: {
    title: 'Design', icon: DraftingCompassIcon,
    intro: [
      'Design turns the customer order into a clear, buildable plan. Your work connects the commercial Scope of Supply to drawings, calculations, and the material definition that the shop will use.',
      'Use Home for your assigned work, Operations for the wider department view, and Projects when you need the complete order history. The Help sections below follow the normal Design flow from scope to release.',
    ],
    features: [
      architectureFeature('Design', DESIGN_ENGINEERING_DIAGRAM),
      feature('scope', 'Scope of Supply and new projects', FileInputIcon, [
        "The Scope of Supply is the list of what the order includes, taken from the Sale Order lines. It shows as a card on the project page with a Generated PDF and, when Sales attached one, the original Order Acknowledgement file.",
        "Create the project: Projects → New Project, then pick the Sale Order (search by order number or customer). Project No, customer, company, order date, Model Category, Model Design, Model Capacity and Model Pressure are filled in from the order. They are only defaults: change anything that is wrong. Tick SIB for a small industrial boiler. You can also attach a Scope of Supply document in the same form.",
        "Only a Design Head or a manager can create a project. Creating it starts the Design milestone and tells Design and Engineering.",
        "Edit Project (on the project page) changes the Sale Order or the details later. Delete Entire Project is on the same page for a manager, the Design Head or the Engineering Head; it first lists the documents the project already has.",
      ]),
      feature('calc', 'Calculation Sheets', CalculatorIcon, ["Open Calc Sheets in the top bar, pick the project, then the sheet. The sidebar has Calculation (Worksheet and Analysis), Registry, Methodology, Library, Tables, Audit, Calc Links and Portfolio.", "Save a snapshot when a calculation is ready for review. A snapshot is the frozen record of the exact inputs and formula versions used."]),
      feature('drawings', 'Drawings', RulerIcon, [
        "Open Drawings in the top bar and pick the project from the dropdown. This is a release tracker, not a CAD editor.",
        "Add Drawing: give a title, pick the type (GA, Foundation, SDC, End Box, Saddle, Fire Bars, Chimney, Ducting, IBR, Electrical Control Panel, or type your own) and a due date. A Design Head must choose who it is assigned to; a designer's own drawing is assigned to them.",
        "Upload the file on the drawing. The assigned person clicks Submit for review (it needs at least one file). The Design Head is notified and clicks Approve or Send back. Un-approve puts an approved drawing back to in progress. The badge then reads Approved by and the name.",
        "Only the Design Head or the assigned person can change the title, type, description and notes. The Head's changes are saved with Save, which also notifies the assigned person.",
        "Customer uploads: files the customer uploads from their portal are listed under Customer uploads on the same page. Mark each Reviewed or Needs changes (a note is required); the customer is told.",
        "Calc Links (in Calc Sheets) records which calculation sheet backs which drawing.",
      ]),
      {
        key: 'notifications', label: 'Notifications', icon: BellIcon, group: true,
        body: ['There are three notification paths for Design. Customer covers the customer’s comments and approvals. Internal (Design) covers handoffs that stay entirely inside Design. External (Departments) covers every signal that crosses a department or commercial boundary — Sales, Procurement, PM tier.'],
        children: [
          feature('notifications-customer', 'Customer', BellIcon, [
            'A drawing only reaches the customer because a Design Head chose to share it. The "Share with customer" switch on each drawing in the Drawings tab is Head-only. A Designer cannot toggle it, same as approving a drawing.',
            'The effect is immediate once switched on. The customer can open the file, read and reply in the comment thread, and, once the drawing is Under review, approve it right away. There is no waiting period on that side.',
            'Only a drawing that has actually reached Under review, Approved, or As built becomes visible, even with the toggle on. A Not started or In progress drawing stays internal regardless of the toggle, so sharing early does not leak unfinished work.',
            'The customer’s order-progress screen reflects this with no extra words. The Design & Engineering step turns from blue to amber with a clock icon whenever a shared drawing is sitting Under review and waiting on them. Only the color and icon change; the label still just says "In progress."',
            'A notification is not sent instantly. It fires five minutes after the toggle is switched on, and only if it is still on at that point. Flip it off within those five minutes, for an accidental click, and nothing is ever sent. Flip it on again later and the five-minute clock restarts.',
            'The comment thread is shared, not duplicated. What you write on the drawing in the Drawings tab and what the customer writes in their portal land in the same thread. Each message is tagged "Customer" when it is theirs, so it is always clear who said what.',
            'Today this notification is in-system only. The customer sees it in their own portal bell. WhatsApp delivery is planned as an addition later, not a replacement for this.',
          ], {
            value: 'The customer-visible toggle is a release gate, separate from your own Under review or Approved status. It exists so a drawing can be technically ready in the system before a Design Head has actually decided the customer should see it.',
            outcome: 'The customer sees exactly the drawings a Design Head chose to share, can act on them the instant they are shared, and is notified once, not on every click, five minutes after a genuine, sustained toggle-on.',
            checklist: [
              'Turn the toggle on only when the drawing is genuinely ready for the customer to review. Turning it on does not itself change the drawing’s status.',
              'Expect the customer to be able to act immediately. Do not treat the five-minute delay as a window to undo a real share.',
              'Read the customer’s comments on the drawing itself (Comments, Design Head only). There is no separate customer inbox to check.',
            ],
            watchOut: 'Toggling a drawing visible and then off again within five minutes is genuinely silent: no notification, no trace the customer would see. Do not rely on that window to "test" sharing with a real customer. Use it only to correct a real mistake.',
          }),
          feature('notifications-internal', 'Internal (Design)', BellIcon, [
            'Internal means the event happens inside Design\'s own chain — no other department is involved on either end.',
            'Milestone handoff within Design: Design owns four consecutive milestones (Design, Submit Design Approval, Release BOM / PR, Release All Drawings). When one closes, the next teammate assigned to the following one is notified it\'s their turn — same mechanism as a cross-department handoff, it just never leaves Design because both ends belong to Design.',
            'A Design milestone reopened by Design itself: if a Design Head sends a Design milestone back for rework, the assigned teammate is notified directly.',
          ], {
            value: 'Not every handoff Design deals with involves another team — most of the day-to-day is Design handing work to Design. Keeping that internal traffic separate from cross-department signals makes it obvious at a glance whether a notification needs you to loop in someone outside Design or not.',
            outcome: 'A Design teammate can tell, from the notification alone, that the work is staying inside the department — no other team needs to be pulled in to act on it.',
            checklist: [
              'Treat an internal handoff exactly like an external one for urgency — it still blocks the next milestone in the chain.',
              'If an internal reopen arrives, recheck the actual calc/drawing before assuming the earlier close-out still stands.',
            ],
            watchOut: 'Internal does not mean low-priority. Release BOM / PR and Release All Drawings are still the milestones Procurement and Production are waiting on next — an internal delay becomes an external one the moment it\'s late.',
          }),
          feature('notifications-external', 'External (Departments)', BellIcon, [
            'External means another department — or Sales/PM as a commercial party — is the source or the destination of the event, not Design\'s own chain.',
            'This is the same bell every internal department uses. It sits top right of the app, shows a red unread count, and is polled automatically. Click a notification to jump straight to its project, or mark one or all as read from the same panel.',
            'A new Sale Order is created: Design is notified the moment Sales creates a Sale Order or converts an accepted quotation into one — earlier than the Scope of Supply notification below, since a Sale Order can exist before it becomes a Project. Every PM-tier account (admin/manager/executive) receives the same notification at the same time.',
            'A new order reaching Design: creating a project from a confirmed Sale Order (a Design Head or PM converting it) notifies both Design and Engineering that a new Scope of Supply exists — separately, Sales and PM tier are notified too, since converting is the moment they\'ve been waiting to hear about.',
            'Milestone handoff crossing into or out of Design: when the milestone immediately before one of Design\'s own belongs to another department (rare — Design usually starts the chain) or when Design\'s last milestone (Release All Drawings) closes and hands off to Procurement, that other department is notified automatically.',
            'Milestone reopened from outside Design: if a milestone downstream discovers a problem traced back to Design\'s earlier work and that Design milestone gets reopened, Design gets a second notice that the work it already handed off is no longer actually finished.',
            'Cross-department task raised against Design: any other department raising a task with Design as the target notifies Design the same way a milestone handoff does.',
            'Unlike the Customer subsection above, none of this is a toggle anyone controls. It is automatic for every user with Design department access. There is nothing to turn on or off.',
          ], {
            value: 'External notifications exist so Design never has to check another team\'s screen to find out an order has landed, work has been sent back, or someone outside the department is waiting on a response. Every signal here crosses a department (or a commercial) boundary — Sales, Procurement, a PM — not from anyone deciding to notify Design.',
            outcome: 'Design can trust the bell as the one place a cross-department signal will appear, with enough context (project, title, body) to act without asking who sent it or why.',
            checklist: [
              'Treat an unread badge as a real queue, not a suggestion. Clear it by acting, not by mass-marking read.',
              'Follow a notification\'s link into the actual project record instead of acting from memory of the title alone.',
              'If an external reopen notification arrives, recheck the work before assuming your earlier close-out still stands — someone downstream found a real problem.',
            ],
            watchOut: 'Marking a notification read is not the same as resolving what it is about. The bell only proves you saw it. The underlying milestone, task, or drawing still needs the real action.',
          }),
        ],
      },
      feature('bom', 'Material definition and BOM', ClipboardListIcon, ["Open Engineering → BOMs, pick the project, and click Upload PMB (.xlsx) to import the PMB workbook. Review the detected rows, the Configuration rows and the skipped rows in the preview, then confirm. The BOM tree (one node per sheet and heading) is built for you.", "Define the material description, MOC, size/specification, make, quantity and category of each line. Design and Engineering own the technical definition; downstream teams add purchasing and receipt information.", "Never replace a live BOM without reading the preview: it says how many lines will be replaced and how many are kept because they already have orders or receipts."]),
      feature('remnant', 'Cutting & Remnant Matching', ScissorsIcon, [
        'For any plate, MS section, or angle line, Category + numeric dimensions are what let the system automatically check that line against remnants already sitting in Stores the moment you release the BOM.',
        'A match reserves the physical piece and quietly keeps that line out of Procurement — it still looks like a normal BOM line to you, nothing extra to check or click on your side.',
      ], {
        checklist: [
          'When you add a plate/section BOM line, pick its Category and fill in Length/Width/Thickness (and MOC) — a line without these is simply invisible to matching, no error, it just goes to Procurement like before.',
          'Release the BOM the normal way: Engineering → Release BOM (or the Release button on Engineering → BOMs) → pick the project → Release BOM. Matching runs automatically the instant you release — there is no separate step or button for it.',
          'You do not need to check whether a line matched. Stores sees a "Remnant reserved" badge and Production sees a ready-to-cut piece; your BOM view looks the same either way.',
        ],
      }),
      milestoneTrackerFeature([
        ['Design', 'Explicit action', 'The milestone starts by itself when the project is created. The Design Head closes it with Approve Design in Engineering → Design Sign-off.'],
        ['Submit Design Approval', 'Automatic', 'Completes once every customer-visible drawing on the project has been approved by the customer — the same per-drawing approval already tracked in the Drawings panel, just rolled up.'],
        ['Release BOM / PR', 'Explicit action', 'Design or Engineering clicks Release BOM (Engineering → Release BOM, or the same button on Engineering → BOMs) once every line has a category and a place in the BOM tree — this is also the moment Cutting & Remnant Matching checks every plate/section line against Stores.'],
        ['Release All Drawings', 'Automatic', 'Completes when every drawing of the project is approved by the Design Head (Drawings → Approve). Needs at least one drawing.'],
      ]),
      feature('tasks', 'Tasks and handoffs', ListChecksIcon, ["Use Tasks for small follow-ups that do not deserve a milestone: Home → Tasks → add a task with a due date. To ask another department for something, open Operations and use Raise on the Incidents card, or Raise on the project page.", "When a milestone closes, the next department is notified by the bell. Do not rely only on memory or a private note."]),
      feature('requests', 'Purchase requests', MessageSquareIcon, [
        "Open Engineering → Purchase Requests. Design and Engineering raise purchase requests from the Engineering screen; the separate Requests screen in the top bar is for Stores.",
        "For each line: search the Item Master and pick the item (or type a description for something not in the catalog), check the category, MOC and size, then pick the project and enter the quantity. Choose No project for a general purchase. One line can be split across several projects. Use template fills the form from a saved PR template.",
        "Click Raise PR. The request gets a PR number and goes straight to Procurement's Enquiry tab; there is no approval step. Stores is told as well.",
        "Engineering → PR History lists every request with its status. The pencil edits a line (Head of the department that raised it). Engineering → PR Templates saves a set of lines you raise often.",
      ]),
      feature('calc-registry', 'Calculation: Worksheet and Registry', CalculatorIcon, ['Calc Sheets → Calculation → Worksheet is where you enter the inputs of a sheet and see every formula recompute at once.', 'Registry lists every variable of the sheet (inputs, constants, computed values) with its unit and current value. Edit an input here or on the Worksheet; both change the same value.', 'Save a snapshot to freeze the inputs and results for the record.'], { outcome: "The sheet's inputs are entered and a snapshot holds the result.", watchOut: "Formulas are shared by all sheets. Change a formula only in Methodology, and it needs the Design Head's approval." }),
    ],
    howTo: [
      { title: 'Start a new order', body: 'Open Projects → New Project and pick the Sale Order. Check the filled-in model, capacity and pressure, then create the project and read its Scope of Supply card.' },
      { title: 'Prepare technical work', body: 'Open Calc Sheets, pick the project and sheet, enter the inputs, clear the validation warnings and save a snapshot. Open Drawings, pick the project, Add Drawing and upload the file.' },
      { title: 'Submit work for approval', body: 'On your drawing in Drawings, click Submit for review after uploading the file. The Design Head is notified. You can not approve your own work.' },
      { title: 'Review and approve Design work', body: 'The Design Head opens Drawings, checks the file against the calculation snapshot, and clicks Approve or Send back. When the calculations and drawings are ready, the Design Head opens Engineering → Design Sign-off, picks the project and clicks Approve Design.' },
      { title: 'Handle corrections and access', body: 'A drawing that is sent back returns to its assigned person with your note. A Design Head can give or remove Designer access for Design employees from Settings; managers assign the Design Head.' },
      { title: 'Release the material definition', body: 'Open Engineering → BOMs, upload the PMB or build the tree, fix descriptions and sizes, clear the uncategorized and unassigned counts, then click Release BOM.' },
      { title: 'Raise a purchase request', body: 'Open Engineering → Purchase Requests, add the lines with project and quantity, and raise it. Check it in Engineering → PR History.' },
      { title: 'Hand work to another team', body: 'Use Raise on the Operations Incidents card or on the project page for a specific action. Include the project and a due date.' },
    ],
  },
  Engineering: {
    title: 'Engineering', icon: CalculatorIcon,
    intro: [
      'Engineering converts the agreed scope into calculations, drawings, and a technically complete Bill of Materials. Your output is the reference that Procurement, Stores, Production, QC, and Dispatch depend on.',
      'Keep technical facts in the project record, not only in email or personal files. A good Engineering record makes the next department’s job obvious.',
    ],
    features: [
      architectureFeature('Engineering', DESIGN_ENGINEERING_DIAGRAM),
      feature('scope', 'Scope of Supply', FileInputIcon, ['Review the released scope before starting detailed work. If the scope is unclear, raise the question as a task instead of silently making a commercial assumption.']),
      feature('calc', 'Calculation workspace', CalculatorIcon, ['Open Calc Sheets in the top bar, pick the project and the sheet. Use Calculation for the inputs and results (Worksheet, Analysis), Registry for every variable of the sheet, Methodology for formulas and validations (a formula change needs the Design Head), Library to import published formulas, Tables for reference data, and Audit for snapshots.', 'A snapshot preserves the calculation as it was run. Use Reproduce in Audit when someone asks why a result changed.']),
      feature('drawings', 'Drawings and release', RulerIcon, ['Open Drawings in the top bar and pick the project. Add Drawing, upload the file, and the assigned person clicks Submit for review; the Design Head clicks Approve or Send back. The full steps are in the Design guide under Drawings.', 'Approved drawings are what a BOM node links to and what QC lists on its forms, so do not leave a drawing waiting in review.', 'Calc Links (in Calc Sheets) records which calculation sheet backs which drawing.']),
      feature('bom', 'Master BOM', ClipboardListIcon, [
        'Open Engineering → BOMs, pick the project, and click Upload PMB (.xlsx). Check the preview before confirming: item rows, Configuration rows (datasheet facts), skipped rows, the category of each line and its Item Master link. Confirming also builds the BOM tree from the sheets and headings.',
        'Procurement owns purchase status and references; Stores owns receipt fields. Do not overwrite another department’s fields.',
        'Category: a line with no category blocks Release BOM. Click the uncategorized tile at the top of the BOM to go through them one at a time. If the app asks “did you mean…” for a mistyped word and you accept, it remembers the correction for the next import.',
        'Item Master link: the import links a line when its name, or its size and material, match exactly one catalog item. Click the not linked to catalog tile to review the rest: sure matches are pre-ticked, others show candidates to pick. What you confirm is remembered for the next import.',
        'A cell that holds several sizes and quantities is split into one line per size when they pair up exactly; otherwise use Split multi-value items on the node’s Items tab.',
      ]),
      feature('notifications', 'Notifications', BellIcon, [
        'New order: when a project is created from a Sale Order, Engineering and Design are both told that a new Scope of Supply exists.',
        'Template applied: when someone else applies a Structure Template to a project’s BOM, Engineering is told. You are not notified for your own action.',
        'Change notes: a Design or Engineering Head is told when a change note is waiting for approval; the person who raised it is told when it is approved or rejected.',
        'Engineering owns no milestones (Design owns Design, Design Approval, Release BOM and Release All Drawings), so there are no milestone hand-off alerts for Engineering alone.',
        'All of these arrive on the bell at the top right. Settings → Alerts lets each person switch an alert off or have it emailed.',
      ], {
        value: 'These alerts tell Engineering when a project’s BOM or its approved definition changes from outside its own hands.',
        outcome: 'Engineering hears about a new order, a template applied by someone else, and change notes without opening each project to check.',
        checklist: [
          'Treat a new Scope of Supply alert as the cue to open the project and confirm the technical assumptions.',
          'After a template alert, review the lines it added; a template is a starting point.',
          'Do not expect an alert for routine BOM edits or drawing changes.',
        ],
        watchOut: 'Marking an alert read only shows you saw it. The lines a template added still need the same review as any other BOM content.',
      }),
      feature('requests', 'Purchase Requests', FileTextIcon, [
        'Open Engineering → Purchase Requests. Design and Engineering raise purchase requests here, inside the Engineering screen. The separate Requests screen in the top bar is for Stores.',
        'For each line: search the Item Master and pick the item, or type a description for something not in the catalog. Check the category, MOC and size or dimensions. Then pick the project and enter the quantity; choose No project for a general purchase. click Add project to split one line across projects. Tick the traceability needed at receipt (heat number, MTC, supplier batch, serial number).',
        'Use template (top right) fills the form from a saved PR template. Engineering → PR Templates is where those are saved and edited.',
        'Click Raise PR. It gets a PR number and appears at once in Procurement’s Enquiry tab under PR Items; there is no approval step. Stores is told too.',
        'If an existing BOM line is wrong, correct that line instead of raising a new request for the same material.',
      ]),
      feature('milestones', 'Tasks and milestones', ListChecksIcon, ['Engineering has no milestones of its own. The Design milestones (Design, Submit Design Approval, Release BOM / PR, Release All Drawings) cover the shared Design and Engineering work; the Design guide’s Milestone Tracker says what completes each.', 'Use Tasks for small follow-ups: Home → Tasks, or Raise on the Operations Incidents card to ask another department.']),
      feature('bomStructure', 'BOMs (assemblies)', LayersIcon, [
        'Open the Engineering tab (top nav) → BOMs, pick a project, then work its tree: search, filter by missing drawing / pending ECN, rename, reorder (Move Up/Down), Move to… a new parent, or Duplicate a node — all from the tree pane.',
        'Select a node to add or assign BOM items, link Drawings, review its Engineering Change Note history, and set its quantity multiplier — right from that node’s own tabs, no need to leave the workspace. Calculation sheets link to a drawing instead — from Calc Sheets → Calc Links.',
        'A system’s datasheet (type, flow, speed, motor rating…) is kept in the node’s Overview → Configuration, not as BOM items — see “Configuration (datasheet fields)”.',
        'The project picker (in the sidebar header, shared with Release BOM — pick a project once, both tabs stay on it) only shows unreleased projects by default (searchable — type to filter) — toggle "Show released too" to bring an already-released one back into the list; a project already open stays visible either way.',
        'Below the editable tree, the read-only "Final BOM" card is the same structure as a clean, full-depth outline — search a node or item, Expand/Collapse all, or download a print-ready PDF. Any line with more than one number in its quantity (e.g. "2 Nos 1 No") gets a warning flag — only the first number feeds the roll-up total. A node with real cut/consumed stock against it shows the actual weight recorded so far, never a projected or scaled figure.',
        'Once a project has been released more than once, a "Live / Rev N" picker appears on the Final BOM card — pick a past revision to see the tree exactly as it looked at that release (a clear banner marks it as frozen, not live); "Live" always shows the current state, including anything changed after the last release.',
      ]),
      feature('bomConfiguration', 'Configuration (datasheet fields)', SlidersHorizontalIcon, [
        'What it is: the datasheet of a system or subsystem, such as TYPE, FLOW cfm, STATIC HEAD, SPEED RPM, TYPE OF MOUNTING, MEDIUM, OPERATING TEMP and MOTOR RATING for a fan. It is a list of label and value pairs saved on the node, not BOM items.',
        'From an import: when you upload a PMB, rows like these are recognised and shown in the preview under “Configuration (N)” for each sheet, and are saved on the right subsystem instead of the item list. Tick “Treat as item” on any row you want kept as an item.',
        'Edit it: select the system or subsystem → Overview → Configuration. Add rows, change text, move rows up or down, remove rows, then click Save (Discard undoes unsaved changes). Two rows cannot share the same label.',
        'Fix old imports: if items on a node look like datasheet fields, a yellow note offers “Review & convert”. Pick the rows and confirm; they become configuration and the item rows are removed. This is refused after the BOM is released, and for lines raised through a Purchase Request or that already have quotes, orders or receipts.',
        'Where you see it: the node’s Overview, the Final BOM card and its PDF (shown under the node, no quantity), and any Structure Template saved from it.',
      ]),
      feature('structureTemplates', 'Structure Templates', LayoutTemplateIcon, [
        'What it is: a Structure Template is a saved copy of part of a BOM: one system with all its parts, or every system of a whole boiler. You save it once and reuse it on any new project instead of building the same tree again.',
        'Where to find them: Engineering → Structure Templates. Each row shows the template name, its version (v1, v2…), its level (System, Subsystem…), the model, how many nodes and items it holds, and where it has been used. The star marks the default template for that level and model.',
        'Save one: build the structure in a project’s BOMs tab. To save one piece, select that node and click the bookmark icon (“Save as template”). To save the whole BOM, click the bookmark icon at the top (“Save Entire BOM as Template”). Give it a name and, if you like, a model such as SF.',
        'Use one: on a new project’s BOMs tab, click “Build from Templates” (the layout icon) and tick the templates you want. To add a smaller template under a node, open that node’s Overview tab and use “Apply Template”. You get a copy that you are free to change.',
        'Rename one: click the template’s name, type the new name, and save. Only the name changes.',
        'Change what is inside: for a single-system template, click the pencil, edit it in the editor, then click “Update Template”. For a whole-BOM template (several systems) the pencil is switched off. Instead, apply the template to a draft project, edit that BOM, then click “Save Entire BOM as Template”, choose “Update existing template”, pick it, check the before-and-after counts, and confirm.',
        'Versions: each time a template’s content is updated its version goes up (v1 → v2). Saving without any change does not raise it. A node built from an older version shows an orange note, “newer version available”. That note is only information; nothing in your BOM changes unless you choose to rebuild it.',
        'See where it is used: click “Used on N nodes in M projects” on the row. You get a list of projects and nodes, with the version each was built from, and you can click a project to jump to its BOM.',
        'Delete (bin icon): if the template was never used, it is deleted for good. If BOMs were already built from it, it is only removed from the lists (archived), and those BOMs carry on exactly as they are.',
      ]),
      feature('subsystemBuilds', 'Subsystem builds (Add subsystem)', LayoutTemplateIcon, [
        'What it is: a standard FD fan, ID fan, feed line and so on, saved once as a “build” and added to any BOM in a few clicks. Each build is a Structure Template with a subsystem family (for example FD Fan Blower); a family can have several builds, such as 5 HP and 10 HP.',
        'Save a build: open the subsystem node on a real project that is right, click the bookmark icon, name it by its build (“FD Fan Blower — 5 HP”), check the Subsystem family and save. A Design or Engineering Head can later open Structure Templates → Family & lines to rename the family and mark each line Required, Usual or Optional. Required: every build has it. Usual: most do. Optional: only some.',
        'Add one: on a project’s BOM click the Add subsystem icon next to Build from Templates. It is added under the node you selected, or at the top level if none is selected. Pick the subsystem, pick the build, tick the lines you want (required and usual lines start ticked, optional ones unticked) and click Add. Sizes, quantities and the configuration values are copied as saved — change them on the BOM afterwards.',
        'Possibly missing: once builds exist, the BOM header shows a “possibly missing” count — lines the saved build always has and this BOM does not. A different size of the same item counts as present. It is a list to read and never blocks release. Use “Not needed here” on a line that is deliberately absent.',
        'Good to know: changing a template never changes a BOM already built from it; the node shows “newer version available” instead. Saving a build again from a real node keeps its Required / Usual / Optional marks.',
      ]),
      feature('subsystemsReport', 'Subsystems', SearchIcon, [
        'What it is: a read-only view of what each kind of subsystem (FD Fan Blower, ID Fan Blower, Feed Line, Blow Down Line…) contains across your projects. Nothing here changes any BOM.',
        'Where to find it: Engineering → Subsystems. The first screen lists every subsystem found in the BOM trees with the number of projects that have it. Click one to open it.',
        'Reading the table: each row is a line, “In 9 of 14” says how many of those projects have it, and each project is a column showing the size and quantity it uses. Projects are sorted by model and capacity, so a 5 HP build and a 10 HP build sit next to each other. Datasheet values (flow, head, motor rating) are shown first. “not linked” marks a line that is not tied to an Item Master item yet. “also an item” means a fact kept as configuration on one project and as a purchased line on another — decide once which it should be.',
        'Use it to decide what a standard build should contain, then save that build as a Structure Template. Download CSV or Excel to take it to a review.',
      ]),
      feature('whereUsed', 'Where-Used', SearchIcon, ['Open the Engineering tab → Where-Used, search a part description, and see every project (and assembly, where assigned) that carries a matching part.', 'The header\'s project filter (checkboxes, pick one or several) narrows the search to only those projects — leave it empty to search everything, same as before.']),
      feature('commonUncommon', 'Common / Uncommon', Repeat2Icon, ['Open the Engineering tab → Common/Uncommon to see which parts are reused across 2+ projects versus used on exactly one — a starting point for stocking decisions, not a Stores action in itself.', 'The header\'s project filter genuinely recomputes common/uncommon against just the projects you pick, not a display trick — a part can read differently filtered than it does across everything.']),
      feature('ecn', 'Engineering Change Notes', FileEditIcon, ['Raise an ECN from the Engineering tab (or the project’s BOM table) whenever a released BOM field needs a controlled change — field, old value, new value, and a real reason.', 'A department Head approves or rejects; approval applies the new value and stamps the project’s current release revision.', 'The header\'s project filter narrows this list to one or several projects at a time — clear it to see every project\'s change notes again.']),
      feature('design-signoff', 'Design Sign-off', BadgeCheckIcon, ['Engineering → Design Sign-off: pick the project and Approve Design. Only the Design Head can do this.', 'It closes the Design milestone and starts the next one. The project page then shows Design signed off.'], { outcome: "The project's design is approved with the Design Head's name and date.", watchOut: 'Sign off only after the calculation sheets and drawings are ready; later changes go through a Change Note.' }),
      feature('pr-history', 'PR History', ClipboardListIcon, ["Engineering → PR History lists every purchase request, newest first, with each line's project, quantity, size and current status.", 'Search by PR number, item or project, or filter by status.', 'The pencil on a row edits that request line: description, MOC, dimensions, and its projects and quantities (change or clear the project, add or remove a split). Only the Head of the department that raised it, or a manager, can edit.'], { outcome: 'You can see what was requested, for which project, and where it stands.', watchOut: 'A split that already has a quote, PO or receipt can not be removed, and a line can not move to another project once it has stock or receipt records.' }),
      feature('item-master', 'Item Master', BoxesIcon, [
        'Engineering → Item Master is the catalog of every material and bought-out item. BOM lines, purchase requests and stock all link to it.',
        'Search across name, code, category, group, HSN and description. Click a column to sort.',
        'Add item: Item Name and UOM are required. Before saving, the app lists items that look the same; pick Create anyway only if it is really new. The item code (IM-…) is given automatically and can not be changed.',
        'Edit (pencil): change the name, category, BOM Category, HSN and description, and set defaults that fill in whenever the item is picked on a BOM or purchase request: Default MOC, default dimensions (thickness or section size, never length), Requires manufacturing, and the traceability ticks. The dialog shows how many BOM lines and projects use the item.',
      ], { outcome: 'Each real item exists once, with the defaults that save typing on every BOM.', watchOut: 'There is no delete. Changing a default affects only lines picked afterwards; existing BOM lines keep their values.' }),
      feature('release-bom', 'Release BOM', BadgeCheckIcon, [
        'Engineering → Release BOM (or the Review & Release BOM button on Engineering → BOMs): pick the project. The strip at the top counts items, drawing-linked lines, unassigned lines, uncategorized lines and pending change notes.',
        'Release is blocked while any line has no category or is not placed on a BOM node. Click the uncategorized or unassigned tile to fix them one at a time, then release.',
        'Releasing closes the Release BOM milestone, starts Procurement’s Enquiry milestone, freezes each line’s drawing revision, saves a snapshot of the tree (Rev 1, Rev 2…), and checks every line against Stores: stock and matching remnants are reserved, only the shortage goes to Procurement.',
        'Un-release (send back) reopens the milestone with a reason so the BOM can be corrected and released again as the next revision. The PDF button prints the BOM.',
      ], { outcome: 'The BOM is released as a numbered revision and Procurement and Stores can act on it.', watchOut: 'Only Design or Engineering can release. Drawings linked and pending change notes are shown for information; they do not block release.' }),
      feature('bom-tools', 'Unit count, split orders, Delete Entire BOM', LayersIcon, [
        'Unit count (number box at the top of Engineering → BOMs): for an order of several identical units, enter the number once. Every quantity for Procurement, Stores and Dispatch is multiplied by it, and the screen shows the sum, for example 100 Nos = 2 Nos × 50. A node’s own quantity multiplier still works for repeats inside one unit.',
        'Split into units (same strip): creates one unit project per boiler under the order, each with its own milestones, job card, QC documents and packing list. The BOM stays on the order. After a split, the +N control adds more units.',
        'Delete Entire BOM (bin icon, Design or Engineering Head): removes every node and line of a BOM that has not been released. It is refused if any line was raised by a purchase request or already has quotes, orders, receipts or QC records.',
        'Save Entire BOM as Template, Build from Templates and Add subsystem are on the same strip; see Structure Templates and Subsystem builds.',
      ], { outcome: 'A multi-unit order is defined once and bought, received and packed for every unit.', watchOut: 'Delete Entire BOM can not be undone. Save the BOM as a template first if you may need it.' }),
      feature('pr-templates', 'PR Templates', LayoutTemplateIcon, ['Engineering → PR Templates: save a set of request lines you raise often (item, MOC, size, quantity).', 'On Engineering → Purchase Requests click Use template to fill the form from one, then pick the project and adjust.'], { outcome: 'A repeated request is raised without retyping its lines.', watchOut: 'A PR template only fills the request form. To reuse BOM structure, use Structure Templates.' }),
    ],
    howTo: [
      { title: 'Read the order', body: 'Open the project from Projects, read its Scope of Supply card and the Sale Order details before starting calculations.' },
      { title: 'Run and freeze a calculation', body: 'Open Calc Sheets, pick the project and sheet, enter inputs, resolve validation warnings, and save a snapshot with a meaningful note.' },
      { title: 'Prepare the BOM', body: 'Open Engineering → BOMs, pick the project, click Upload PMB, check the preview and confirm. Then clear the uncategorized, unassigned and not linked to catalog tiles.' },
      { title: 'Request a new material', body: 'Open Engineering → Purchase Requests, pick the item, enter size, MOC and quantity, pick the project, and raise it. It goes to Procurement’s Enquiry tab.' },
      { title: 'Release the BOM', body: 'Open Engineering → Release BOM, pick the project, check the counts and click Release BOM. Raise a Change Note for any change after release.' },
    ],
  },
  Procurement: {
    title: 'Procurement', icon: ShoppingCartIcon,
    intro: [
      'Procurement turns BOM requirements into supplier quotes, selected suppliers, purchase orders, and reliable delivery status. The same material may serve several projects, so the Procurement workspace is cross-project.',
      'The key habit is to keep the commercial trail complete: request, comparison, supplier, PO, transit, and receipt should be understandable to someone who was not present when the decision was made.',
    ],
    features: [
      architectureFeature('Procurement', PROCUREMENT_DIAGRAM),
      feature('enquiry', 'Enquiry', SearchIcon, [
        'Procurement → Enquiry lists every line that needs a supplier. Three views: PMB Items (lines from a released project BOM), PR Items (purchase requests raised by Design, Engineering or Stores) and Custom Items (items you add yourself with Add Item). Filter by project or search.',
        'What reaches Enquiry: when a BOM is released, Stores’ stock is checked first. A line fully covered by stock never comes here; a line partly covered comes with only the shortage. A purchase request appears immediately, with no approval step. You are notified in both cases.',
        'A “Stock available” note on a line means Stores still holds free stock of that item; check with Stores before buying. A “Reserved from stock” note means part is already covered and this line is the shortage.',
        'From a line you either send an RFQ to suppliers or add a quote by hand. Once a line has a quote it also shows in Selection.',
      ]),
      feature('quotes', 'RFQs and quotes', GitCompareIcon, [
        'Create RFQ (Procurement → Enquiry): tick the lines, pick the suppliers, and send each supplier their private link by WhatsApp, Email or Copy link. The supplier opens the link and types price, unit, payment terms and delivery date; you are notified when a quote arrives and it appears on the line.',
        'Edit / send on an RFQ sends the link again, adds suppliers, or removes a supplier who has not quoted. Cancel RFQ withdraws it. Each supplier shows as Not sent, Sent no reply, or Responded.',
        'Add quote records a quote yourself (phone or paper quote): supplier, price and unit, payment terms, expected delivery date.',
        'A quote is never edited or deleted. If a price changes, add a new quote; the history explains the final choice.',
        'RFQ emails go from the Procurement mailbox set in Settings → Procurement · Email. If no mailbox is set, use WhatsApp or Copy link.',
      ]),
      feature('supplier', 'Selection', Building2Icon, [
        'Procurement → Selection shows every line that has at least one quote, with the quotes side by side. Lowest price and Fastest delivery are marked.',
        'Click Select on the quote you choose. The line is added to that supplier’s draft purchase order (a draft is created if there is none). Undo selection takes it back off the draft.',
        'If Selection is empty it says Waiting on supplier quotes; go back to Enquiry and send or chase the RFQ.',
      ]),
      feature('po', 'Purchase Orders', FileTextIcon, [
        'Procurement → Purchase Orders lists draft, issued and cancelled orders; the Active / Fulfilled switch hides orders whose lines have all arrived. One order is for one supplier.',
        'Open an order to see its PDF. On a draft: Edit changes lines, quantities, rates and terms; pick the company if the lines have no project. Issue sends it out: the lines move to Ordered and the PDF downloads.',
        'On an issued order: Cancel Issue returns it to draft, Cancel PO cancels it for good, Record Bill enters the supplier’s bill, and Inbound opens the supplier’s page.',
        'Terms & Conditions (button on this tab) sets an optional second page printed on every PO of a company.',
      ]),
      feature('delivery-lots', 'Delivery Lots', TruckIcon, [
        'Procurement → Delivery Lots: pick an issued PO and group its quantities into lots, each with its own expected delivery date (for example 30 on 20 Sep, 70 on 5 Oct). A lot can hold several lines.',
        'Quantities not put in a lot keep the delivery date from the supplier’s quote. For an order split into units you can tick which units a lot is meant for.',
        'Stores sees these dates on Inward, and Overdues uses them.',
      ], { outcome: 'Stores knows what is expected and when, line by line.', watchOut: 'Only issued POs can be scheduled. Reducing a PO line below what is already in lots is refused.' }),
      feature('status', 'Status', ListChecksIcon, ['Procurement → Status lists every line with its stage: Enquiry, Comparison, Ordered, Transit, Received, Cancelled or In-Stock. Search or filter by status.', 'The stage moves by itself: a quote moves a line to Comparison, issuing the PO to Ordered, the supplier’s recorded dispatch to Transit, and Stores’ receipt to Received. You can change a status here by hand to correct a mistake.', 'Keep PR and PO references readable because Stores and Production use them downstream.']),
      feature('vendor-bills', 'Vendor Bills', ReceiptIcon, [
        'Record a bill: open the issued PO in Purchase Orders and click Record Bill. Enter the supplier’s bill number and date, check the lines, choose a TDS section if tax is deducted, and tick reverse charge if it applies. GST is split into CGST + SGST or IGST from the supplier’s state.',
        'Procurement → Vendor Bills lists the bills. Set a bill to Approved when it is correct: that posts it to the ledger, updates the stock cost, and tells Accounts. Accounts records the payment.',
        'Debit Note on a bill records an amount the supplier owes back, for example for returned material.',
      ], { outcome: 'Every supplier bill is on record against its PO and reaches Accounts for payment.', watchOut: 'An approved bill is in the books. Correct it with a debit note, not by editing.' }),
      feature('inbound', 'Inbound (supplier link)', TruckIcon, [
        'Every issued PO has one supplier link: the same link the supplier got with the RFQ if there was one, otherwise a link made for the PO. Use the Inbound button on a PO row, in the PO, or on Delivery Lots to open it.',
        'On that page the supplier (or you, on their behalf) downloads the PO and records the dispatch: lines and quantities, LR / vehicle / tracking details, invoice and e-way bill numbers, and up to 3 photos or PDFs. Recording a dispatch moves those lines to Transit and notifies Stores and Procurement.',
        'A dispatch can not be changed once Stores has received goods from it.',
      ]),
      feature('purchaseReturns', 'Purchase Returns', Undo2Icon, ['Procurement → Returns: Raise Return against an issued PO (wrong spec, damage, over-supply). Set the inspection result, then the stock action (Remove from stock, or Replaced with no stock change), and type the debit note reference.']),
      feature('requests', 'Purchase requests from other departments', ClipboardListIcon, ['Design and Engineering raise purchase requests from Engineering → Purchase Requests; Stores from Requests. Each one appears in Procurement → Enquiry under PR Items as soon as it is raised.', 'Source it like any other line. Ask the requesting team for missing technical information through a task so the request stays traceable.']),
      feature('notifications', 'Notifications', BellIcon, [
        'Supplier sent a quote: goes to whoever created the RFQ and opens Selection at that line.',
        'New PR waiting in Enquiry, and BOM released with lines waiting: open Enquiry filtered to that request or project.',
        'Material rejected: QC failed an incoming inspection or rejected a delivery; replace it or raise a return.',
        'Purchase order needs voiding: a line on an issued PO was cancelled. Supplier dispatched goods: a supplier recorded a dispatch.',
        'Settings → Alerts lets each person switch an alert off or have it emailed.',
      ], { outcome: 'You hear about new demand, quotes and problems without checking each tab.', watchOut: 'An alert opens the right screen; the work still has to be done there.' }),
      {
        key: 'suppliers', label: 'Suppliers', icon: Building2Icon, group: true,
        body: ['Suppliers has two parts. Roster is the plain contact list — add, edit, or deactivate a supplier, and see their quote history one at a time. Analysis is a read-only report over the same quotes and purchase orders, rolled up: a Dashboard overview, By Supplier (spend, win rate, activity), and By Item — the "Purchase Card," a price history across every supplier who has ever quoted a material. Nothing under Suppliers needs separate data entry — it all comes from what Enquiry and Purchase Orders already log.'],
        children: [
          feature('suppliers-roster', 'Roster', Building2Icon, [
            'Procurement → Suppliers → Roster. Add supplier (top right) opens a form: name, GST number, contact person, phone, email, address and default payment terms. Only the name is required.',
            'The pencil edits a supplier. The bin removes one: a supplier with no history is deleted; one with quotes, RFQs, orders or bills is switched off instead and leaves every list, with its history kept.',
            'The bulk import on this tab replaces the whole roster from the party-master file; use it for a full refresh, not to add one supplier.',
          ], {
            value: 'A clean, deduplicated supplier list is what keeps a quote comparison meaningful — "Kirloskar" and "Kirloskar Bros" logged as two different suppliers would quietly split one supplier\'s track record in half.',
            outcome: 'Every supplier you deal with exists exactly once, with current contact details, and a name a Designer or Head can pick confidently while logging a quote.',
            checklist: ['Check the list for a near-duplicate name before adding a new supplier.', 'Keep contact person and phone current — this is what Enquiry work actually uses day to day.'],
            watchOut: 'Deactivate, don\'t delete-and-recreate, for a supplier you are not currently using — recreating loses the link to their quote history.',
          }),
          feature('suppliers-analysis-dashboard', 'Analysis — Dashboard', BarChart3Icon, [
            'Open Suppliers → Analysis; Dashboard is the default view. It is a portfolio summary: total suppliers with real activity, quotes logged, total issued-PO spend, and overall win rate across everyone.',
            'Below the stats: issued-PO spend for the last six months, the top suppliers by spend, the top win rates (suppliers with at least two quotes, so one lucky quote does not read as 100%), and the most-quoted materials.',
            'Every chart here is the same underlying data as By Supplier and By Item, just aggregated — use Dashboard for the five-second read, and drill into the other two views when you need one supplier or one material in full.',
          ], {
            value: 'The other two views answer "tell me about this one supplier" or "tell me about this one material." Dashboard answers the question that comes before either of those: where is the real spend and activity concentrated across everyone, right now.',
            outcome: 'A glance at Dashboard before a sourcing or renewal conversation tells you who actually matters in the numbers, without opening every supplier one at a time.',
            checklist: ['Treat the six-month spend trend as a shape, not a precise total — it only counts issued POs, same as everywhere else in Analysis.', 'A thin dashboard (few bars) usually means few quotes logged yet, not that nothing is happening — check Enquiry.'],
            watchOut: 'Win rate here only includes suppliers with 2+ quotes on purpose — a single win or loss is not a rate.',
          }),
          feature('suppliers-analysis-supplier', 'Analysis — By Supplier', Building2Icon, [
            'Switch to By Supplier. The table ranks every active supplier by issued-PO spend, with quote count, quotes won, and win rate next to it.',
            'Click a supplier row to expand their full quote history inline — the same material/project/price/date detail as Roster, without leaving the report.',
            'The bar chart above the table is the same spend numbers, just the top few suppliers at a glance before you scroll the full table.',
          ], {
            value: 'Price comparisons today live one quote at a time, on one BOM line. This rolls that up: which suppliers actually get the business, how often, and for how much — the pattern a single line never shows.',
            outcome: 'Before renewing terms or picking a supplier for a new enquiry, you can see their real track record — spend, win rate, quote volume — in one place instead of remembering it.',
            checklist: ['Sort by spend first when the question is "who matters most," by win rate when the question is "who actually gets picked."', 'Expand a supplier before assuming a low win rate means a weak supplier — check what they were quoting against.'],
            watchOut: 'Spend only counts issued POs. A supplier with strong quote activity but no issued PO yet will show real quotes and zero spend — that is correct, not a bug.',
          }),
          feature('suppliers-analysis-item', 'Analysis — By Item (Purchase Card)', SearchIcon, [
            'Switch to By Item and pick a material from the chip list — it is every distinct material description that has at least one logged quote, most-quoted first.',
            'The detail panel shows every supplier who has ever quoted that exact material, the price, the project, and the date — plus a price-trend line once there are at least three quotes to trend.',
            'Use this before opening a new enquiry for something you have likely bought before: the cheapest logged price and who quoted it are both right there.',
          ], {
            value: 'A price quoted six months ago on a different project is easy to forget and expensive to re-negotiate blind. This is the "have we bought this before, and for how much" check in one place instead of searching old projects.',
            outcome: 'Before accepting a new quote, you can see whether it is actually competitive against this material\'s own history — not just against the other quotes on the current enquiry.',
            checklist: ['Search the material description if it is not in the first page of chips — the list is sorted by quote count, not alphabetically.', 'Treat the price trend as a pattern, not a forecast — it plots logged history only.'],
            watchOut: 'A material typed slightly differently across two quotes (extra spacing, a different abbreviation) shows as two separate cards here — this groups on exact text, it does not fuzzy-match descriptions.',
          }),
        ],
      },
      milestoneTrackerFeature([
        ['Enquiry', 'Automatic', 'Starts when the BOM is released, or when any line gets a quote or moves past Enquiry. Each later step starts when the one before it completes. Completes once every BOM item on the project has moved past Enquiry into Comparison or further — "all items must clear the stage," not just the first one.'],
        ['Comparison', 'Automatic', 'Completes once every item has moved past Comparison into Ordered or further.'],
        ['Ordered', 'Automatic', 'Completes once every item has moved past Ordered into Transit or further.'],
        ['Transit', 'Automatic', 'Completes once every item has reached a closed status — Received, Cancelled, or In-Stock.'],
        ['Procured', 'Automatic', 'Same trigger as Transit — every item closed. The two often complete together, since arriving is usually the same real-world event as being fully procured.'],
      ]),
      feature('overdues', 'Overdues', AlertTriangleIcon, ['Procurement → Overdues lists ordered material whose expected delivery date has passed and that Stores has not received.', 'The date comes from the Delivery Lot for that line, or from the supplier quote when no lot was made.', 'Use Inbound on the purchase order to see what the supplier has recorded as dispatched, then call the supplier or update the lot date.'], { outcome: 'Every overdue line has either arrived or has a new, agreed date.', watchOut: 'A line stays here until Stores receives it. Changing the status by hand hides the problem without fixing it.' }),
    ],
    howTo: [
      { title: 'Work a new enquiry', body: 'Open Procurement → Enquiry, check the line’s description, size and quantity, tick the lines and Create RFQ. Send each supplier their link by WhatsApp or Email.' },
      { title: 'Compare and select', body: 'Open Procurement → Selection, compare the quotes on each line, and click Select on the one you choose. The line goes onto that supplier’s draft PO.' },
      { title: 'Issue the PO', body: 'Open Procurement → Purchase Orders, open the draft, check supplier, lines, quantities, rates and terms, then Issue. Send the PDF to the supplier.' },
      { title: 'Track delivery', body: 'Use Delivery Lots to record expected dates, Inbound to see what the supplier dispatched, and Overdues for lines past their date.' },
      { title: 'Record the bill', body: 'When the supplier’s bill arrives, open the issued PO, click Record Bill, then approve it in Vendor Bills so Accounts can pay.' },
      { title: 'Close or cancel', body: 'A line becomes Received when Stores receives it at Inward. To cancel, use Cancel PO, or change the line’s status in Status and tell the supplier.' },
    ],
  },
  Stores: {
    title: 'Stores', icon: WarehouseIcon,
    intro: [
      'Stores is the physical truth of material: what is on hand, what is reserved, what arrived, and what is still pending. Accurate receipt data prevents both shortages and false availability.',
      'Use the Stores tab for stock work, Projects/BOM for project context, and Requests when a new material requirement needs Procurement attention.',
      'You now get a notification whenever a new BOM lands — an import, a single item, or a purchase requisition line — so Demand shouldn\'t need a blind daily check anymore.',
      'Operations has a Stores pipeline diagram now (the same kind of glance Procurement, Sales, and Design already have) — SAS/Trade, BOM Released, and Build Stock as the three sources feeding in, then Requests → Stores Review → Reserved → In-Stock, with Received (via Procurement) as the one outcome from Procurement\'s own pipeline Stores actually needs to see.',
    ],
    features: [
      architectureFeature('Stores', STORES_DIAGRAM),
      feature('sidebar', 'The Stores sidebar, top to bottom', LayersIcon, [
        'Receiving — Inward: record what physically arrived against a PO line (a partial delivery is fine; the quantity arrived so far is shown). Anything QC has not cleared shows as "Awaiting QC clearance" and cannot be routed or used yet. Gate Entry: the security log of each vehicle that came in (this was called Gate Inward; Dispatch\'s own "Gate Passes" are for material going OUT).',
        'Fulfillment — Demand: one card per project whose production starts soon (pick the window), showing for each line whether it is Covered, On order (Late if the delivery is after the start date) or Needs action — with who owns the next step (Stores, Procurement or QC). Reserve from stock, Raise PR for a real shortage, or Ask the owning department. Take back / Withdraw undo your own decision while nothing is built on it. Trade Orders: material Sales asked for against a sale order. Indents: Production\'s written requests — release a line, cancel an indent, or tick "Show released & cancelled" for history. Allocator has two tabs: To route (tick Production or Dispatch, then Apply) and Routed (take a decision back while no Production request or packing list exists; reserved stock is listed there too and leaves Stores by itself). Trade Orders also lists their reserved stock with a Hand over button. Inward has four tabs: Search, Bulk by project, Awaiting QC and Remnants (offcuts Production sent back: Confirm puts one into stock, Scrap it writes it off).',
        'Orders — Allocator: anything that has arrived (fully or partly) or been reserved from stock lands here so you can decide Production or Dispatch; tick one, then Apply Allocations. Reserved stock stays reserved until it is issued; under the Allocator you also see the reserved stock waiting to be handed over (Issue) or released (Unreserve). When a packing list containing reserved material is marked Dispatched, that stock is issued automatically. Macro Allocator: for orders split into many units — open an order, then Allocate (hand material to units; click the Allocated number to take some back), To route (tick Production or Dispatch for a line and Apply; the pencil picks only some units) and Routed (what went where; the pencil takes it back).',
        'Production — On Floor: the record of material issued to the shop floor. Reports — Stock Statement: opening, added, removed and closing stock per item for any dates.',
        'Inventory (bottom of the sidebar): the stock list itself. Set a Cost per unit (₹) on each item so the stock value in reports is not zero.',
      ], {
        checklist: [
          'Start the day at Inward (new arrivals and QC holds), then Allocator (what needs a Production/Dispatch decision), then Demand.',
          'Receive what actually arrived even if it is only part of the order; do not wait for the full quantity.',
          'Do not leave lines sitting in the Allocator — Dispatch and Production cannot pack or indent them until you route them.',
        ],
        watchOut: 'Old links and notes that say Open Requests, Ready to Issue, Gate Inward or Issued to WIP now mean Demand, the Allocator (Ready to Issue no longer exists — project stock leaves on indent release or dispatch; trade-order stock uses Hand over), Gate Entry and On Floor.',
      }),
      feature('stockreport', 'Stock Movement & Project Consumption report', ClipboardCheckIcon, [
        'Stores → Stock Statement (the same report as Reports → Stock Movement & Project Consumption) shows, for any date range, each item\'s opening stock, what was added, what was removed and the closing stock, with its value, and below that what each project consumed. Download it as PDF or Excel.',
        'The history is recorded automatically from 30 Sep 2026; earlier dates cannot be reported and the report says so. If a closing balance ever differs from what is on hand now, the report shows a red warning instead of a wrong number.',
        'Value uses each item\'s Cost per unit, so enter it on the Inventory item (Edit) — otherwise value shows 0.00.',
      ]),
      feature('inventory', 'Inventory', BoxesIcon, ['Inventory shows on-hand quantity and the quantity reserved for active project requirements. Available stock is the usable balance after reservations.', 'Item numbers: the Item Master number (IM-…) and inventory number (INV-…) show beside each line on Inward, Demand, Allocator, Macro Allocator, Indents and On Floor. The search boxes on Inward, Indents and On Floor find lines by these numbers.', 'Keep item names and units consistent so the same stock is not entered twice under slightly different names.', 'Set a minimum stock level per item (New item / edit) to get a "Low" flag once available stock drops to or below it. Click the low-stock count — on the card title or the "low stock" chip above it — to filter the table down to just those items; toggle it off the same way.', 'Every item shows its own code (auto-generated if you do not set one) — use it and the search box above the table to find an item fast once the list grows past a screenful.', 'New item now captures dimensions and material the same way a BOM line does — pick a Category to get real Length/Width/Thickness (or size) fields instead of typing a spec string by hand, and Material/grade is a searchable list instead of free text.']),
      feature('reserve', 'Reservations (and the Allocator)', ClipboardCheckIcon, ['Reserve stock against a BOM requirement when material is committed to a project. A reservation reduces available stock without pretending the material has already been issued.', 'Release a reservation when the requirement is cancelled or fulfilled another way — this fully frees the quantity back to available; there is no separate "reassign to a different project" action, releasing and reserving again is how you move committed stock to a different requirement.', 'A green "✓" badge under a request\'s description is a real match — both sides were picked from the item catalog (search when raising the request, or search in the New Item dialog) and share the same underlying item. A muted "≈" badge is the older, weaker signal: plain keyword overlap, not automated, when no catalog link exists on one or both sides. Trust the ✓; still eyeball the ≈ before reserving.', 'Reserving does not change the BOM line\'s purchase status by itself — only Issue does. Procurement sees a "Reserved from stock" badge on the line the moment you reserve, so they know not to duplicate the sourcing work, but the line still technically shows as open until you actually Issue it.', 'Reservations work identically whichever kind of demand you\'re reserving against — a normal project BOM line, a Stock request, or a SAS trade request all draw from the same available pool, no special cases.']),
      feature('review', 'Allocation Mode (Automatic / Stores Review)', ClipboardCheckIcon, [
        'Every material requirement — a released Project BOM line or a Sales SAS/trade request — follows the company\'s Allocation Mode. Stores is the inventory authority for both; it is not a mandatory approval step every requirement has to pass through just because Stores exists.',
        'Automatic (the default, recommended mode): the moment a requirement is created, the system checks it against an exact catalog match in Inventory. Full stock available → the whole line reserves itself and never reaches Procurement. Partial stock → the available part reserves itself and only the shortfall becomes a Procurement requirement. No matching stock → the full requirement goes straight to Procurement. You never have to click Reserve or Procure for a line Auto already resolved — an "Auto-reserved" badge (or "Remnant reserved" for plate/section stock, which was already automatic) marks it done, no action needed.',
        'Stores Review / Manual: every new BOM/SAS requirement instead waits in Stores Review — a "Stores Review" badge, invisible to Procurement until you act — and you choose Reserve from stock or Procure per line, exactly as before.',
        'Switch modes from the settings (cog) next to the Demand search — Stores-only, takes effect immediately for every new requirement from that point on (it does not retroactively re-decide requirements that already landed).',
        'Auto does not mean Stores loses control. You can always Reserve/Procure a line yourself, and Release any reservation — including one Auto made — the same way you always could. Auto means "allocate automatically unless Stores intervenes," not "Stores is out of the loop."',
        'If you Release a reservation Auto made (stock needed elsewhere, wrong match, damaged material, anything) the line goes back to needing a decision and you get a fresh notification saying so — same as releasing a manually-made reservation.',
        'Only an exact catalog match (the same real, non-fuzzy "✓" signal Reservations below already trusts) is ever auto-reserved — a plain keyword-overlap "≈" match is never safe to auto-commit physical stock against, so those lines still need your eye.',
      ], {
        diagram:
`                 DEMAND
            ┌──────┴──────┐
            │             │
          PROJECT        SAS
            │             │
            └──────┬──────┘
                   ▼
             BOM / REQUEST
                   │
                   ▼
          ┌─────────────────┐
          │ Allocation Mode │
          └───────┬─────────┘
                  │
       AUTO ──────┼────── MANUAL
         │                     │
         ▼                     ▼
 Reserve stock            Stores decides
         │                     │
         ├── Available → Reserved    ├── Reserve
         │                           └── Procure
         └── Shortage → Procurement`,
        value: 'Project BOMs and Sales SAS requests create material demand. The system then follows the company\'s Allocation Mode. In Automatic mode, available Stores inventory is reserved automatically and only shortages go to Procurement. In Manual mode, Stores reviews the requirement and decides whether to reserve stock or send it to Procurement. Before this, every new line landed in Procurement\'s queue the instant it was released, whether or not Stores already had the material — Automatic mode closes that gap without turning Stores into an approval queue for every ordinary line.',
        outcome: 'In Automatic mode, only requirements Stores actually needs to act on — a genuine shortfall, an exception, an override — ever need a click. Procurement only ever sees the unmet quantity, never the part Stores already reserved. In Manual mode, every fresh line still gets an explicit Stores decision before Procurement sees it.',
        checklist: [
          'Check Inventory (or the possible-match badge) before deciding — Procure is a real choice, not a default to fall back on when unsure.',
          'Do not sit on a Stores Review line — it is genuinely invisible to Procurement until you act, so a forgotten line delays the project silently.',
          'Reserve if you have it; Procure if you do not, or if using existing stock would leave nothing for the requirement that already has a claim on it.',
          'Treat a "reservation released — needs a decision" notification as seriously as a brand-new line — it is exactly that, again.',
        ],
        watchOut: 'Procure cannot be undone by re-clicking it — once a line reaches Procurement, treat any further change (need less, cancel outright) as a normal request to Procurement, not something to fix by reversing this button.',
      }),
      feature('receipt', 'Receiving material (Inward)', PackageCheckIcon, ['Stores → Inward → Search: find the line by material, project, PR or PO number, or pick a date filter (Overdue, Due today, Due this week). Each line shows its make, supplier, PO and expected date. Click Receive.', 'In the Receive dialog enter the quantity that arrived (it starts at what is still outstanding and shows how much has been received so far), pick or create the receipt (supplier, GRN reference), and fill any heat number, MTC, batch or serial details the line requires. If the same request was split across projects, tick the others and enter their quantities.', 'A line raised with no project asks whether to assign it to a project now or store it in inventory.', 'Bulk by project receives many lines of one project under one receipt. Every receipt waits for QC under Awaiting QC; once QC approves it the material counts as stock and the line appears in the Allocator.']),
      feature('remnant', 'Cutting & Remnant Matching', ScissorsIcon, [
        'A plate or section line in Inventory can hold real physical pieces instead of one plain quantity — each piece has its own dimensions, a computed weight, and a status (available, reserved, consumed, or scrap).',
        'The moment Design releases a matching BOM, a fitting piece reserves itself automatically. You will see it in Demand, not as something you did.',
        'The Pieces dialog (layers icon) groups by the original piece you received — a plate that has been cut shows one collapsed row with a one-line summary ("2 pieces cut — 1 used, 1 scrap"); expand it to see the actual used/remnant/scrap children with their own codes and status.',
      ], {
        checklist: [
          'Give a plate/section stock line a Category and MOC — New item, or edit an existing one — this is what matching checks against, the same as the BOM line\'s own Category/MOC.',
          'Add each physical piece under that line: click the layers icon next to it → Add piece → enter length/width/thickness for a plate (or length + kg per metre for a section) and density.',
          'Watch for the "Remnant reserved" badge in Demand — that line already found its match and needs nothing from you. A plain "Stores Review" line still needs your usual Reserve/Procure decision.',
          'If a matched line\'s requirement changes or gets cancelled, open its piece (layers icon) and click Release to free it back to available stock for the next match.',
          'Cutting is Production\'s action (Shop Floor → Remnants → Cut). An offcut they keep comes back to Stores → Inward → Remnants: click Confirm to put it into stock, or Scrap it.',
        ],
      }),
      feature('sas', 'Trade Orders (SAS) and Build stock', BoxesIcon, ['Stores → Trade Orders lists material Sales asked for against a SAS sale order (Sales uses Request Stores on the order). Reserve it from stock or send it to Procurement, the same as a project line; Hand over when it leaves Stores.', 'A trade request follows the same Allocation Mode as a project line: in Automatic mode it reserves itself from stock and only a shortage reaches Procurement.', 'Build stock is how Stores buys for its own shelves: Requests → Purchase Requests, set Kind to Build stock, pick the inventory item and the quantity to build. When it is received the stock goes up.', 'Stores does not raise trade (SAS) requests; those come from Sales.']),
      feature('notifications', 'Notifications', BellIcon, [
        'You receive a notification the moment new material demand exists, from any of two sources: Engineering/Design importing a BOM workbook or adding a single BOM item, or any department raising a purchase requisition line — including Sales pushing a SAS material request against their own Sale Order.',
        'A trade request from Sales shows under Trade Orders and sends the same notification; there is no separate inbox and no need for Sales to message you.',
        'You also receive a notification the moment Procurement marks a BOM line Received, so you know material has actually arrived for a project (named by project number), landed as stock, or been received against a SAS trade request, without opening the BOM yourself to check.',
        'You receive a notification if a reservation gets released on a line that\'s still in Stores Review (see Manual review) — that line needs a fresh Reserve/Procure decision, and this is how you find out instead of it quietly sitting unresolved in Demand.',
        'Other Stores alerts: Production raised an indent, QC approved or rejected an inward review, a remnant came back from Production, a supplier recorded a dispatch, and material shortages for projects starting soon.', 'All of these arrive on the bell at the top right. Settings → Alerts lets each person switch an alert off or have it emailed.',
      ], {
        value: 'Before this, Demand only told you what had already landed if you thought to check it, and a Received line was invisible until you happened to look. The notification exists so both a fresh requirement and material actually arriving reach you the moment either happens.',
        outcome: 'Every new demand — a BOM import, a single item, a purchase requisition line — and every Received line reaches Stores through one bell, with enough context (who raised it, which project, how many lines) to act without opening the BOM to check.',
        checklist: [
          'Treat the bell as the trigger to open Demand or Inward, not a substitute for actually reserving or issuing material.',
          'A SAS notification from Sales needs the same judgment as any other new requirement — check the description and quantity are specific enough before reserving.',
          'A "Procured" notification is your cue to check whether Stores already reserved something against that same line before — reconcile it rather than treating the arrival as automatically new demand.',
          'Do not wait for a notification for material that\'s clearly already overdue on a project you can see in the BOM — the bell covers new demand and new arrivals, not a daily sweep.',
        ],
        watchOut: 'The notification tells you demand exists or material arrived; it does not tell you whether stock is available or already reserved. Still check Inventory (or the possible-match badge) before promising anything back to the requester.',
      }),
      feature('issues', 'On Floor (material issued to the shop floor)', PackageCheckIcon, ['Stores → On Floor lists what has left Stores for the shop floor, newest first. Material released against a Production indent appears here by itself.', 'Log an issue records material that left outside an indent: pick the project, the BOM item and the quantity.']),
      feature('reorder', 'Reorder suggestions', AlertTriangleIcon, [
        'Every item at or below its minimum stock level (the same "Low" flag Inventory already shows) appears under Requests → Reorder Suggestions (Requests is in the top bar) with a suggested replenishment quantity — minimum minus available, editable before you commit.',
        'Create request turns a suggestion into a real Build stock request through the same flow Inventory\'s own stock-request path already uses — it lands in Demand as an ordinary Enquiry line, same as if you\'d raised it by hand.',
        'Nothing is created automatically. A suggestion stays a suggestion — visible, editable, ignorable — until you click Create request; and once you do, that item drops off this list until it needs reordering again.',
      ]),
      feature('inbound', 'Inbound (what the supplier says is on the way)', TruckIcon, [
        'On Inward, a line whose supplier has recorded a dispatch shows it (vehicle / LR / tracking / date). The Inbound button next to Receive opens the supplier page for that PO so you can see the dispatch details and photos before the truck arrives.',
      ]),
      feature('gir', 'Gate Entry (Gate Inward Receipts, GIR)', LogInIcon, [
        'Log every vehicle that enters the gate with material: vehicle number, supplier, driver, a material reference (PO/DC/BOM), and the two security checks (seal intact, documents verified) plus any remarks.',
        'A GIR is the gate-entry record, not the GRN — it exists independently of whether the material has been formally received yet. Attach the GRN reference and close the GIR once receipt is confirmed.',
        'This is a standalone security-desk log, not part of the reserve/available inventory model — creating a GIR never touches on-hand stock by itself.',
      ]),
      feature('tasks', 'Tasks and handoffs', ListChecksIcon, ['Use Tasks for a missing document, a receipt question, or a delivery follow-up. Close the task when the physical or documentary action is complete.', 'Operations now shows Outgoing and Incoming Incidents for Stores, split by direction — same pattern Procurement already has. Raising one from either card sends a real notification to the other department immediately; there is nothing extra to do beyond filling in the Raise dialog.']),
      feature('requests', 'Requests (purchase requests from Stores)', InboxIcon, [
        'Requests is its own screen in the top bar. Its tabs: Purchase Requests, PR History, PR Templates and Reorder Suggestions.',
        'Purchase Requests: choose the Kind. Project material is a line for a project (or No project). Build stock is a line to refill an inventory item. Pick the item, quantity, MOC and size, then Raise PR. It goes straight to Procurement’s Enquiry tab.',
        'PR History lists every request and its status; the pencil edits a line (Head only). PR Templates saves lines you raise often, and for Stores also holds BOM templates that can be applied to a project.',
        'From Demand you can also Raise PR for a real shortage on a project line; that links the request to the existing line instead of creating a second one.',
      ], { outcome: 'Stores can buy for a project or for stock without leaving a paper trail outside the app.', watchOut: 'Reserve what is already in stock first. A line with stock reserved can not also be raised as a PR.' }),
      feature('no-milestones', 'Milestones and Stores', Clock3Icon, ['Stores has no milestones of its own on the Milestone Tracker. Your work moves other departments\' milestones: marking material Received moves Procurement\'s Transit and Procured steps, and releasing material to a project starts Production\'s first milestone.', 'What is waiting on Stores shows on the project as "Currently With: Stores" and in Stores → Demand, not as a milestone.'], { outcome: 'You know which of your actions move a project forward.', watchOut: 'A line left un-received keeps Procurement\'s milestones open for the whole project.' }),
    ],
    howTo: [
      { title: 'Receive material (Inward)', body: 'Open Receiving → Inward, find the line (search, or filter by expected date), click Receive, enter the quantity that actually arrived — a part delivery is fine — plus the supplier/GRN details. The line then waits for QC clearance; once QC approves it, it appears in the Allocator.' },
      { title: 'Reserve stock', body: 'Find the project requirement, choose the inventory item, enter the quantity, and confirm the reservation. Check available balance before promising stock.' },
      { title: 'Check what Automatic mode already did', body: 'In Automatic mode, before reserving anything by hand, check Demand for an "Auto-reserved" or "Remnant reserved" badge — that line already resolved itself and needs nothing from you. Only lines still showing "Stores Review", or genuinely unmatched lines Procurement is now sourcing, are real candidates for a manual Reserve.' },
      { title: 'Hand over trade-order stock', body: 'Trade Orders → Reserved — hand over: click Hand over when the material actually leaves Stores for a trade order. It lowers on-hand and marks the line In-Stock. Project material needs no such step: it leaves Stores when Production\'s indent is released or the packing list is dispatched. For material that is physically leaving for the shop floor outside an indent, use On Floor instead — pick the project and BOM item and log the quantity.' },
      { title: 'Handle a mismatch', body: 'Do not force a receipt into the wrong line. Raise a task to Procurement or Engineering with the PO, material description, and actual quantity.' },
      { title: 'Close the loop', body: 'Make sure the BOM receipt fields, inventory quantity, and reservation state agree before closing the Stores task.' },
      { title: 'Act on a reorder suggestion', body: 'Open Requests → Reorder Suggestions, check the suggested quantity against what you actually want to hold, adjust it if needed, and click Create request. Reserve from stock first if a request in Demand could be filled from what you already have — Reorder Suggestions is for topping up depleted stock, not a substitute for reserving.' },
      { title: 'Log a Gate Entry (GIR)', body: 'The moment a vehicle enters with material, log a GIR: vehicle, supplier, driver, a material reference, and the two security checks. Enter at least a vehicle number or supplier — a blank GIR is not a real record.' },
      { title: 'Close a Gate Entry', body: 'Once the material is actually received (via Procurement\'s GRN or your own confirmation), enter the GRN reference on the GIR row and click Close. Close is disabled until a GRN reference exists — a closed GIR always means the receipt is real, not just that the gate visit is over.' },
      { title: 'Route material in the Allocator', body: 'Open Orders → Allocator. Every line that has arrived (fully or partly) or been reserved from stock is listed. Tick Production (it needs fabrication) or Dispatch (goes straight to packing) — the tick is pre-filled from the line — select the lines and click Apply Allocations. Reserved stock stays reserved until the packing list leaves the gate; dispatching it issues the stock automatically.' },
      { title: 'Handle a Trade Order', body: 'Fulfillment → Trade Orders lists material Sales asked for against a sale order. Fill it from stock (Reserve) or send it to Procurement, exactly like a project requirement.' },
      { title: 'Release an Indent', body: 'Fulfillment → Indents lists Production\'s requests, one card per indent with a progress bar. Click a card header (or the arrow) to fold it; the double-arrow beside "Show released & cancelled" folds or opens all. Release each line for the quantity you actually hand over; partial releases are fine. The icons on each card are PDF (the live state), Cancel (nothing released yet) and Delete (only if nothing was released); hover for the name. On split orders each indent line shows its unit and "remaining" is counted per unit.' },
      { title: 'Undo a decision', body: 'Nothing here deletes a BOM line. Take back what you decided while nothing is built on it: Take back (Demand reservation), Withdraw (a Build Stock or Trade Order line nobody has ordered), Un-procure (a PR Procurement has not started), the pencil in Allocator/Macro Allocator "Routed" (routing), and the Allocated number on a unit (allocation). If something downstream already exists you are told what blocks it. To cancel a project line, use Ask Engineering to cancel.' },
      { title: 'Set the cost of an item', body: 'Inventory → Edit an item → Cost per unit (₹). Stock value in reports uses it. Items bought through Procurement get their cost updated automatically when the vendor bill is approved.' },
      { title: 'Delete an inventory item', body: 'Inventory → the bin icon. Only an item with no stock and no history (never received, reserved, issued or returned) can be deleted; otherwise it is kept for the record and you are told why.' },
      { title: 'Get the stock statement', body: 'Stores → Stock Statement (or Reports → Stock Movement & Project Consumption): choose From/To dates to see opening, added, removed and closing stock per item and what each project consumed; download PDF or Excel.' },
      { title: 'Raise a purchase request', body: 'Open Requests (top bar) → Purchase Requests. Kind Project material buys for a project (pick the project, or No project); Kind Build stock buys for your shelves (pick the inventory item). Add the lines and click Raise PR. It goes to Procurement’s Enquiry tab. PR History shows it afterwards.' },
      { title: 'Confirm a remnant from Production', body: 'Stores → Inward → Remnants lists offcuts Production kept after cutting. Put the piece on the shelf and click Confirm; it becomes free stock. Use Scrap it if it is not worth keeping.' },
    ],
  },
  Production: {
    title: 'Shop Floor', icon: HardHatIcon,
    intro: [
      'Shop Floor is where Production records the work on each job: the Job Card with its stages, handing finished work to Dispatch, asking Stores for material, cutting plate and section, and the workers’ daily sheet.',
      'The Shop Floor sidebar has three groups. Shop Floor: Job Card and Dispatch. Resources: Material Indent, Remnants and Workers. Sign-off: Approvals.',
      'A separate Planning tab in the top bar holds the look-ahead: Material Plan, Schedule, Capacity, Cut and Backlog.',
    ],
    introFlow: {
      heading: 'From material to a finished job',
      subheading: 'What Production does, in order.',
      stages: [
        { boxes: [{ title: 'Material Indent', body: 'Stores routes material to Production. Shop Floor → Material Indent → To indent: tick the lines and create the indent. Stores releases it.' }], arrowNote: 'Plate and section pieces reserved for you show under Remnants → Cut.' },
        { boxes: [{ title: 'Job Card', body: 'Shop Floor → Job Card → New Job Card for the project. Start and Finish each stage as the work is done.' }], arrowNote: 'Finish alerts QC.' },
        { boxes: [{ title: 'QC sign', body: 'QC signs each finished stage from QC → Approvals → Job Card Stages, or sends it back.' }], arrowNote: 'Starting the DISPATCH stage opens the hand-over.' },
        { boxes: [{ title: 'Hand over to Dispatch', body: 'Tick the finished subsystems and hand over. They go onto the project’s draft packing list.' }], arrowNote: 'Production also approves the packing list before it leaves.' },
        { boxes: [{ title: 'Milestones', body: 'The Production milestones start with the first stage and close when every stage of every job card is QC-signed.' }] },
      ],
    },
    features: [
      architectureFeature('Production', PRODUCTION_DIAGRAM),
      feature('jobcards', 'Job Card', HardHatIcon, [
        'Shop Floor → Job Card shows one tile per job. New Job Card: pick the project (or the unit of a split order), enter the job number, and choose the card: Boiler (33 stages) or APH, the air pre-heater card (16 stages, with the owner/fitter name). A project can have more than one card.',
        'Open a card to see its stage table, laid out like the paper job card: stage, start date, end date, fitter/welder, test certificate, Production sign, inspection date, QC sign and remarks.',
        'For each stage: pick the fitter/welder and click Start; today is stamped as the start date. Click Finish when the stage is done: the end date and your name as Production sign are stamped, and QC is alerted. QC then signs the stage or sends it back; a stage sent back is done again and finished again.',
        'You can link a test certificate to a stage, type remarks, attach a scan of the paper card (Job card scan), and print the card in the paper layout.',
        'Starting the DISPATCH stage tells Dispatch and opens the hand-over overlay on the card (see Dispatch below).',
      ]),
      feature('dispatchHandover', 'Dispatch (hand over finished subsystems)', TruckIcon, [
        'Shop Floor → Dispatch is where finished work leaves Production. Nothing is ticked on the project BOM; whether a line is done is worked out from what you hand over here.',
        'To hand over lists the finished subsystems (first-level BOM groups) of material Stores routed to Production, grouped by project. Search or filter by project. Tick the finished subsystems, add a note if needed, and click Hand over to Dispatch.',
        'The overlay asks two things. If the project’s last packing list is already packed, choose Start a new draft list or add to that list (it goes back to draft). And always: does Production approve these items for dispatch, Yes or Not yet. If you answer Not yet you can approve later from Approvals.',
        'Handed-over items are placed on the project’s draft packing list automatically (a draft is created if there is none) and Dispatch is notified. Handed over lists what you sent; Undo works until the packing list is packed.',
        'For a split order, hand over per unit; each unit’s items go to that unit’s own packing list. The same overlay opens when you start the DISPATCH stage of a job card.',
      ]),
      feature('indent', 'Material Indent', ClipboardListIcon, [
        'Shop Floor → Material Indent → To indent lists material Stores has routed to Production, grouped by project. Search, filter by project, tick the lines you need and create the indent; one indent is made per project. Stores releases each line.',
        'Raised lists every indent with its status (open, partly released, released, cancelled), a progress bar and a PDF of its current state.',
        'On an order split into many units, indents are per unit: each line shows its unit, and “already indented” is counted per unit.',
        'A line already fully covered by an indent is not offered again, even if Stores has released only part of it. Wait for the release; do not raise a second indent for the same material.',
      ], {
        outcome: 'Stores knows exactly what Production needs for which project, and the release is on record.',
        checklist: ['Raise the indent for what you need now; you can raise another later for more.', 'Check the status under Raised before chasing Stores.'],
        watchOut: 'Only material Stores has routed to Production appears. If a line is missing, ask Stores to route it in their Allocator.',
      }),
      feature('remnant', 'Remnants (cutting plate and section)', ScissorsIcon, [
        'Shop Floor → Remnants → Cut lists every plate or section piece reserved for your work. Click Cut on a piece: the size the BOM line needs is filled in for you.',
        'Enter what was actually used and add a Remnant row for any usable offcut you keep. A plate cut must fit inside the plate (thickness is fixed); a pipe, bar or angle cut must fit its length. Weights and scrap are worked out for you.',
        'The offcut goes to Returns to Stores and waits for Stores to confirm it on their Inward → Remnants tab; then it is free stock for the next job. Scrap it writes off an offcut not worth keeping.',
      ], {
        outcome: 'Each cut is recorded with what was used, what came back and what was scrapped.',
        checklist: ['Cut from the piece reserved for the line, not a different one.', 'Declare the offcut you really kept; do not type weights.'],
        watchOut: 'A cut can not be undone. Check the sizes before you confirm.',
      }),
      feature('attendance', 'Workers (daily sheet and roster)', CalendarDaysIcon, [
        'Shop Floor → Workers has three parts. Overview: the day’s headcount and attendance percentage. Sheet: mark each worker present, half-day or absent and the project they worked on. Workers Roster: the list of shop-floor workers.',
        'A worker is an HR employee record. Add worker searches HR first; if the person exists you add them to the roster instead of creating a second record. Trade is picked from a list (Welder, Fitter, Gas Cutter, Machinist, Grinder, Painter, Rigger, Helper).',
        'The sheet writes to the same attendance record HR uses. Switch a worker off when they leave; do not delete them.',
      ]),
      feature('approvals', 'Approvals (packing lists before dispatch)', ClipboardCheckIcon, [
        'Shop Floor → Approvals lists packing lists Dispatch has submitted for review. Open one and Approve or Reject; a reason is optional. QC decides separately; the list can be dispatched only when both approve.',
        'If you already approved the items when handing them over, Production’s part is filled in.',
      ], { outcome: 'Nothing leaves without Production’s decision on record.', watchOut: 'Only the Production Head can decide.' }),
      feature('planning', 'Planning', ClipboardListIcon, [
        'Planning is its own tab in the top bar. Material Plan answers one question per BOM line: can we cover it? It shows what is needed, what is received or reserved, what free stock or a matching remnant could cover, what is on order and when it arrives, and what is short, with the next step as a button. If you can not do that step yourself the button reads Ask Stores or Ask Procurement and sends a task.',
        'Schedule and Capacity are drawn from Work Orders: bars on a date axis, and each workstation’s load per week (Set capacity enters shifts, hours and working days). Work Orders are not created in the app at present, so both only show Work Orders already in the system.',
        'Cut cuts a piece-tracked stock piece for a project; Shop Floor → Remnants → Cut is the usual place. Backlog is a list of notes on things not yet built.',
      ], {
        outcome: 'You know before production starts which lines are covered and which are short.',
        checklist: ['Start on Material Plan with the Needs attention filter.', 'Lines marked BOM not released are waiting for Design and are not shortages yet.'],
        watchOut: 'Quantities assume the BOM line and the stock use the same unit.',
      }),
      feature('tests', 'Hydro test', FlaskConicalIcon, ['HYDRAULIC TEST is a stage on the boiler job card: start it, finish it, and QC signs it like any other stage.', 'The Hydro Test record itself (result, reference number, inspector, date) is kept in QC → Test Records, on the Hydro Test card. Adding or editing it needs Production access, and opening that screen needs QC access, so today it is entered by someone who holds both, or by a manager. A Pass there completes the Hydro Test milestone; a Fail has a button to create a rework job card.']),
      milestoneTrackerFeature([
        ['Marking, Cutting, Rolling Shell', 'Automatic', 'Starts when the first job card stage of the project is started or finished, when Stores releases material to the project, or when a piece is cut for it.'],
        ['Drilling, Shell Welding, Site Marking, Welding (FURA-B / RC / AR), Box Up, Box Up Welding, Tubes & Stay Rods, Pad Plates / Saddles / Nozzles, Smoke Box / Feed Line / Ladder, Refractory, Painting', 'Automatic', 'All twelve Production milestones (these and Marking/Cutting) complete together once every stage of every job card of the project is finished and QC-signed. Job card stages do not map one-to-one to milestones, so they do not close one by one; close one by hand from the project page if you need it shown earlier.'],
        ['Hydro Test (HT)', 'Automatic', 'Completes only when a Hydro Test record with result Pass is saved (QC → Test Records → Hydro Test card). A QC sign on the HYDRAULIC TEST job card stage does not close it.'],
      ]),
      feature('notifications', 'Notifications', BellIcon, [
        'Material ready to request: Stores routed material to Production; open Material Indent. Material released to you: Stores released your indent.',
        'Job card stage sent back: QC returned a stage. NCR decided: QC decided how to handle a non-conformance.',
        'Packing list waiting for sign-off (Production Head): Dispatch submitted a list; open Approvals.',
        'Settings → Alerts lets each person switch an alert off or have it emailed.',
      ], { outcome: 'You hear when material is ready, released, or a stage needs redoing.', watchOut: 'An alert opens the right screen; the work still has to be done there.' }),
      feature('handoff', 'Tasks and requests to other departments', MessageSquareIcon, ['To ask QC, Stores, Dispatch or another department for something, open Operations and use Raise on the Incidents card, or Raise on the project page. They are notified at once.', 'Your own follow-ups go on Home → Tasks.']),
    ],
    howToGroups: [
      {
        key: 'howto-jobcard', label: 'Create and work a Job Card', icon: HardHatIcon,
        steps: [
          { title: 'Create the card', body: 'Open Shop Floor → Job Card and click New Job Card. Pick the project (or unit), enter the job number and choose Boiler or APH.', why: 'The card is the record every later step hangs on.', verify: 'The new tile shows the right project and job number.' },
          { title: 'Start and finish each stage', body: 'Open the card. On the stage being worked, pick the fitter/welder and click Start. When the work is done click Finish.', why: 'Start and Finish stamp the real dates and your sign, and Finish alerts QC.', verify: 'The stage shows its start date, end date and Production sign, and reads Waiting on QC.' },
          { title: 'Act on a stage QC sent back', body: 'You are notified. Redo the work, then Start and Finish the stage again.', why: 'A sent-back stage is not complete until QC signs it.', verify: 'The stage is finished again and waiting on QC.' },
        ],
      },
      {
        key: 'howto-indent', label: 'Ask Stores for material', icon: ClipboardListIcon,
        steps: [
          { title: 'Raise the indent', body: 'Open Shop Floor → Material Indent → To indent. Tick the lines you need and create the indent.', why: 'Stores releases material only against an indent.', verify: 'The indent appears under Raised with status open.' },
          { title: 'Check the release', body: 'Open Raised. The progress bar shows how much Stores has released; download the PDF if you need a copy.', why: 'A part release is normal; the rest stays open.', verify: 'The lines you received show as released.' },
        ],
      },
      {
        key: 'howto-cut', label: 'Cut plate or section', icon: ScissorsIcon,
        steps: [
          { title: 'Open the reserved piece', body: 'Open Shop Floor → Remnants → Cut and click Cut on the piece reserved for the line.', why: 'The reserved piece already matches the size and grade the line needs.', verify: 'The dialog shows the piece code and the required size.' },
          { title: 'Record what was used and kept', body: 'Check the Used size, add a Remnant row for any usable offcut, and confirm.', why: 'The app works out weights, scrap and the stock change from these sizes.', verify: 'The offcut shows under Returns to Stores, waiting for Stores to confirm it.' },
        ],
      },
      {
        key: 'howto-handover', label: 'Hand finished work to Dispatch', icon: TruckIcon,
        steps: [
          { title: 'Hand over', body: 'Open Shop Floor → Dispatch → To hand over (or start the DISPATCH stage on the job card). Tick the finished subsystems and click Hand over to Dispatch.', why: 'Dispatch can only pack what Production has handed over.', verify: 'The subsystems move to Handed over.' },
          { title: 'Answer the two questions', body: 'Choose a new draft list or the existing packed list if asked, and say whether Production approves the items for dispatch.', why: 'Your approval is needed before the packing list can leave.', verify: 'The items are on the project’s draft packing list.' },
        ],
      },
      {
        key: 'howto-attendance', label: 'Mark attendance', icon: CalendarDaysIcon,
        steps: [
          { title: 'Mark the sheet', body: 'Open Shop Floor → Workers → Sheet, pick the date, and mark each worker present, half-day or absent with the project they worked on.', why: 'HR and payroll read this same record.', verify: 'Overview shows the right headcount for the day.' },
          { title: 'Add a worker', body: 'Open Workers Roster → Add worker, search for the person in HR first, pick their trade, and add them.', why: 'One record per person keeps attendance history together.', verify: 'The worker appears once in the roster.' },
        ],
      },
      {
        key: 'howto-approve', label: 'Approve a packing list', icon: ClipboardCheckIcon,
        steps: [
          { title: 'Decide', body: 'Open Shop Floor → Approvals, open the packing list, check its items, and Approve or Reject.', why: 'Dispatch can not mark a list Dispatched until QC and Production both approve.', verify: 'The row shows Production’s decision.' },
        ],
      },
    ],
  },
  QC: {
    title: 'Quality Control', icon: FlaskConicalIcon,
    intro: [
      'QC records whether the product and its supporting documents meet the required checks. Your records should let a manager answer three questions: what was tested, what was the result, and which document proves it?',
      'Open QC in the top bar. Its tabs: Test Certificates (Certificates, Assign to Units), Test Records, Documents, NCR, Job Cards, Calibration, and Approvals (Inward, Job Card Stages, Pre-Dispatch). The model and project pickers at the top narrow most tabs.',
    ],
    features: [
      architectureFeature('QC', QC_DIAGRAM),
      feature('tests', 'Test records', ClipboardCheckIcon, ['QC → Test Records: pick the project at the top. The page has one card per kind: the general test log (NDE / radiography, MTC checks, other), Incoming Inspection, Finished Goods Inspection, Subassembly Inspection, Hydro Test, and Job-Work Inspection.', 'Add a record with test type, reference number, inspector, date and notes, and set the result: Pending, Pass or Fail. Use Pending until the check is really done. A Fail row has a Raise NCR button.']),
      feature('certificates', 'Test Certificate bank', BadgeCheckIcon, ['QC → Test Certificates → Certificates. Add certificate: upload the mill certificate PDF and the fields are read from it for you to check (certificate number, cast, heat and plate numbers, material spec, maker, chemistry and mechanical values). A certificate is entered once and identified by certificate number + cast number + plate number.', 'Tick the project or projects it is used on, or leave it unallocated. Linking it to a part of a statutory document allocates it to that project automatically.']),
      feature('statutory', 'Statutory documents', FileTextIcon, [
        'QC → Documents: pick the project and create the document. Its parts (Form IV A material) and its mountings and fittings are filled from the project BOM; Sync from BOM adds lines added to the BOM later. The form set follows the project’s model: Form II(1), III, III A and IV A for CF / MF / OF / SF / GF / DF / AF boilers, Form XVII for a project ticked SIB, and Form III with III-H or IV A for headers, PRS and other standalone components. Use the Extra docs dropdown for a header, PRS, FAB or FCB document on a boiler project.',
        'Open the document to work on it: Boiler Details holds the header facts printed on the forms (pressures, dimensions, maker’s number, seams, drawing numbers; the drawing dropdown opens the approved drawing beside the form). Each part is linked to a test certificate with Link certificate; several parts can be ticked and linked at once, and mountings are linked the same way. Form III A groups are created by you with New Group and an assembly of the BOM.',
        'Preview PDF is disabled until the document has parts and every part has a certificate. Share with customer (same rule) puts the finished folder on the customer portal.',
        'Linking a part to its BOM line unlocks certificate suggestions in the Link certificate dialog: ✓✓ means this material and maker pairing was approved 3 or more times before, ✓ means the material spec matches exactly, ≈ means a partial text match. They are suggestions, never automatic. For a split order, a certificate assigned in Assign to Units is filled in by itself.',
        'The pencil on a part edits its number, name, size and quantity.',
      ]),
      feature('stage-sign', 'Job Cards: signing production stages', RouteIcon, ['QC → Job Cards shows the same job cards Production works on. Open a card and click Sign as QC on a stage Production has finished.', 'QC → Approvals → Job Card Stages lists every finished stage waiting for QC across all jobs: sign it, or send it back with a remark so Production redoes it.', 'QC has no project milestones of its own. The Production milestones close when every stage of every job card of the project is QC-signed, so unsigned stages hold the project.'], { value: 'The QC sign on each stage is the inspection record of the job card.', outcome: 'Every finished stage is either signed or sent back with a reason.', checklist: ['Work the Job Card Stages list daily.', 'Inspect before signing; the sign carries your name and the date.'], watchOut: 'A stage sent back must be finished again by Production before it returns to your list.' }),
      feature('notifications', 'Notifications', BellIcon, [
        'Inward review waiting (QC Head): Stores received a delivery; open Approvals → Inward. Material arriving: the first receipt on a project, so incoming inspection can start.',
        'Job card stage ready to sign: Production finished a stage. Packing list waiting for sign-off (QC Head): Dispatch submitted a list; open Approvals → Pre-Dispatch.',
        'Test failed, NCR raised, All items procured (the project is fully bought), and Calibration due or expired (an instrument or jig is due within 7 days or overdue).',
        'All of these arrive on the bell at the top right and open the right tab. Settings → Alerts lets each person switch an alert off or have it emailed.',
      ], {
        value: 'QC’s work is triggered by other departments: a delivery, a finished stage, a packing list. The alerts bring each one to you when it happens.',
        outcome: 'Nothing waits for QC without QC knowing.',
        checklist: ['Clear the Approvals tabs daily; they hold up Stores, Production and Dispatch.', 'Open the alert to land on the exact review.'],
        watchOut: 'Marking an alert read does not decide anything. The review still has to be approved or rejected.',
      }),
      feature('handoff', 'Release and sign-off', ShieldCheckIcon, ['Make the result and supporting references clear for Production, Dispatch, Management, and the customer-facing record. Keep rework visible instead of silently editing a passed record.']),
      feature('stageInspections', 'Incoming / Finished Goods / Subassembly Inspection', ClipboardCheckIcon, [
        'All three are cards on QC → Test Records for the chosen project.',
        'Incoming Inspection: a Pending record is created for you when a bought line is received; fill in the result. Add one by hand for anything missed. A Fail tells Procurement to replace the material.',
        'Finished Goods Inspection: the final check of the finished product. It has a Dispatch eligible switch that QC sets when satisfied; it is shown to the reviewers of the pre-dispatch approval.',
        'Subassembly Inspection: linked to a node of the BOM tree (Engineering → BOMs), for a check before the sub-assembly moves on.',
      ]),
      feature('jobWork', 'Job-Work Inspection', TruckIcon, [
        'Log material sent to an outside job worker: who, quantity sent, expected return date. Fill in received quantity and date once it comes back — variance (sent minus received) is calculated for you.',
        'A job worker is just a name and contact, not a vendor record — there\'s no separate master to maintain.',
      ]),
      feature('calibration', 'Calibration', BadgeCheckIcon, [
        'The Calibration tab (QC workspace, not a project) tracks instruments and jigs/fixtures: due date, certificate reference, and a status of OK, Due soon, Expired, or Blocked.',
        'Block an item to take it out of service before its due date — Blocked always overrides the date-based status.',
      ]),
      feature('ncr', 'NCR & Disposition', AlertTriangleIcon, [
        'QC → NCR lists non-conformance reports. Raise one from a failed row in Test Records (Raise NCR) or directly on the NCR tab; Production can raise one too.',
        'Only the QC Head decides the disposition: Rework, Repair, Scrap (for a tracked stock piece: it is written off) or Use as-is. Scrap and Use as-is need written notes.',
        'After the disposition is carried out, QC clicks Verify, then Close. An NCR can not be closed before it is verified.',
      ]),
      feature('heatlot', 'Heat/Lot Traceability', BadgeCheckIcon, [
        'Stores captures a piece\'s heat number and, optionally, a linked test certificate once, at receipt — every piece cut from it afterward inherits both automatically, with no re-entry at cut time.',
        'Linking a certificate through Stores\' picker allocates it to the project the same way linking one in a statutory document does — it shows up as "used on this project" either way.',
      ]),
      feature('reports', 'Reports', BarChart3Icon, [
        'Test Certificate Register lists every certificate with its mechanical properties, joined to the project(s) it\'s allocated to. Inspection Pass/Fail Summary groups test records by type. NCR Register lists every NCR with its severity, status, and disposition.',
        'Calibration Due/Status mirrors the Calibration tab\'s own OK/Due soon/Expired/Blocked logic as a printable report. Job-Work Inspection Register lists every job-work dispatch with sent/received quantities and the calculated variance.',
        'Every report reads live off the same certificate, test, NCR, and calibration data — there is nothing to enter separately for reporting.',
      ]),
      feature('assign-to-units', 'Assign certificates to units', BadgeCheckIcon, ['For an order split into units: QC → Test Certificates → Assign to Units. Pick the split order, tick the material lines and units a certificate covers, then Assign certificate.', 'One certificate can cover many lines and units; one line of one unit can carry more than one certificate.', "When exactly one certificate is assigned to a line of a unit, it is filled into that unit's Form IV A automatically the next time the document is created or synced."], { outcome: "Each unit's material shows the certificate it was made from.", watchOut: 'Only material Stores has allocated to a unit appears here. Nothing to tick means Stores has not allocated it yet.' }),
      feature('approvals', 'Approvals: inward, job card stages, pre-dispatch', ClipboardCheckIcon, ['QC → Approvals → Inward: every delivery Stores receives waits here. Approve to release the material into stock; Reject keeps it held, and it can be resubmitted after the problem is fixed.', "QC → Approvals → Job Card Stages: stages Production has finished and that need QC's sign before the next stage.", 'QC → Approvals → Pre-Dispatch: packing lists Dispatch has submitted. QC and Production each approve or reject; the list can be dispatched only when both approve.', 'A reason is optional on every decision.'], { outcome: "Nothing is used, moved on or shipped without QC's decision on record.", watchOut: 'Until an inward review is approved, the material does not count as stock and cannot be packed.' }),
      feature('no-milestones', 'Milestones and QC', Clock3Icon, ['QC has no milestones of its own on the Milestone Tracker. Hydro Test (HT) belongs to Production and completes when a Hydro Test record with result Pass is saved on the Hydro Test card in QC → Test Records (adding it needs Production access).', 'Your QC signs on job card stages are what complete Production\'s milestones: they close together when every stage of every job card of the project is finished and QC-signed.', 'Statutory documents, inward reviews and pre-dispatch approvals are not milestones; they show as "Currently With: QC" on the project.'], { outcome: 'You know which QC actions move a project forward.', watchOut: 'An unsigned job card stage keeps all of Production\'s milestones open.' }),
    ],
    howTo: [
      { title: 'Approve a delivery', body: 'Open QC → Approvals → Inward, open the review, inspect the material, and Approve or Reject. Approved material becomes stock; rejected material stays held.' },
      { title: 'Sign job card stages', body: 'Open QC → Approvals → Job Card Stages, inspect each finished stage, and sign it or send it back with a remark.' },
      { title: 'Record a test', body: 'Open QC → Test Records, pick the project, add the record under the right card, and set Pass or Fail when the check is done.' },
      { title: 'Raise an NCR', body: 'On a failed row in Test Records click Raise NCR. The QC Head sets the disposition; after the fix, Verify and Close it in QC → NCR.' },
      { title: 'Add a certificate', body: 'Open QC → Test Certificates → Certificates, Add certificate, upload the PDF, check the fields read from it, and save.' },
      { title: 'Build the statutory folder', body: 'Open QC → Documents, pick the project, create the document, fill Boiler Details, link a certificate to every part, then Preview PDF.' },
      { title: 'Approve a packing list', body: 'Open QC → Approvals → Pre-Dispatch, open the list, and Approve or Reject. Production decides separately.' },
      { title: 'Keep calibration current', body: 'Open QC → Calibration regularly for items Due soon or Expired, and Block anything pulled out of service.' },
    ],
  },
  Dispatch: {
    title: 'Dispatch', icon: TruckIcon,
    intro: [
      'Dispatch turns completed project material into a controlled packing and delivery record. The packing list is the bridge between the BOM and what the customer actually receives.',
      'Use the Dispatch tab to see the board — Operations → Dispatch now shows a summary (flow, incidents, and current projects) instead. Use Projects when you need the order context and the BOM source lines.',
    ],
    features: [
      feature('board', 'Packing Lists', PackageCheckIcon, ['Dispatch → Packing Lists is the board: Draft, Ready and Dispatched. Click a list to open it. New packing list starts an empty list: pick the project and its company, customer, address, contact and invoice are filled in from it (company and customer are only asked when there is no project). Combine lists groups lists that leave in one vehicle into a shipment.', 'The sidebar: Packing (Packing Lists, Pending Items, Shipments), After dispatch (Deliveries, Documents), Gate (Gate Passes) and Sign-off (Approvals).', 'A list shows “List 1 of 2” when its project has more than one.']),
      feature('generate', 'Creating a packing list', ClipboardListIcon, ['Most lists make themselves: when Production hands over finished subsystems they are placed on the project’s draft list.', 'For anything else open Dispatch → Pending Items: tick the ready lines and click Add to the open draft (or Create list from selected; New separate list makes a second list for a part shipment).', 'On an open list, Add items adds a pending BOM line of the project, an Item Master item, or a hand-typed line.']),
      feature('packing', 'Packing details', BoxesIcon, ['Open a draft list. Lines are grouped the way they are packed: loose, package / box, mounted, or bag. Click a value to change it (package label, quantity, IBR number, item code, make). Tick lines to move them to another group, make them one assembly line, expand an assembly, or show an item as sizes; rename a group or change its type from its header.', 'The checklist at the bottom (Fill from valves) lists the valves and mountings to tick off.', 'Set the status to Ready when the contents and header are checked. Only a draft can be edited; a Ready or Dispatched list is never changed by adding lines.']),
      feature('pdf', 'Packing PDFs', FileTextIcon, ['Open the packing list and use the PDF button for the customer copy. The pending-list PDF shows lines still waiting to be packed.', 'Check customer name, address, invoice / DC details, vehicle and dispatch method on the list first. The company printed is the project’s company.']),
      feature('reconcile', 'BOM reconciliation', ClipboardCheckIcon, ['A packing item keeps a link to its BOM line. Use that link to explain what was carried, what remains pending, and why a partial list was created.']),
      feature('handover', 'Handed over from Production', PackageCheckIcon, [
        'When Production hands over a finished subsystem it appears on the project\'s open packing list by itself (a draft is created if none exists) and you get a notification. Check the list, add anything missing, then move it on as usual.',
        'If Production hands over more after the list was packed or sent for review, you are asked nothing — Production chooses a fresh draft or adding to the same list; adding pulls the list back to draft and the review starts again.',
      ]),
      feature('shipments', 'Shipments (combine packing lists)', TruckIcon, [
        'A packing list is the delivery record for one project. Use Combine lists only when two or more projects go to the same address in one vehicle: the lists keep their own PL numbers, approvals, invoices and e-way bills, and gain a shared SHP number.',
        'Split a shipment to undo it. Structure changes lock once every list in it is dispatched; carrier details stay editable. The shipment PDF is a cover page plus each list.',
      ]),
      feature('carrier', 'Carrier and tracking details', RouteIcon, [
        'On a packing list or a shipment, record how it travels: mode (road/rail/sea/air), the LR / RR / BL / AWB number and date, vehicle or container number, tracking link and expected delivery date. These are plain business records shown on the Deliveries tab and the packing list.',
        'There is no live tracking yet; the stored details are what a tracking feed would read later.',
      ]),
      feature('gatepass', 'Gate Passes', FileOutputIcon, [
        'Raise a Returnable or Non-returnable gate pass before material or tooling leaves the gate — party/destination, responsible person, purpose, and an item list. A returnable pass also takes an expected return date; a non-returnable one does not.',
        'Approve, then Issue — a pass only leaves draft once someone with approval authority signs off. Cancel is available before issue.',
        'Once issued, tick each item off as it actually comes back — the pass itself flips to Returned automatically the moment every item on it is ticked, and back to Issued if you un-tick one by mistake.',
        'A returnable pass still out past its expected return date shows an Overdue badge — computed live, not something you have to check for; it clears the moment the pass is fully returned.',
      ]),
      feature('reports', 'Reports', BarChart3Icon, [
        'Dispatch Register lists every dispatched shipment with its freight and e-way bill details. E-Way Bill Register narrows that to shipments carrying an e-way bill number. Freight Cost Summary groups freight spend by who paid it and by month. Pending vs Dispatched Aging is the flip side of the Register — shipments still sitting, by how long.',
        'Every report reads live off the same packing list data — there is nothing to enter separately for reporting.',
      ]),
      milestoneTrackerFeature([
        ['Packing & Labeling', 'Automatic', 'Completes when no draft list is left open and every BOM line of the project is on a Ready or Dispatched list. A part shipment keeps it in progress.'],
      ]),
      feature('pending-items', 'Pending Items', ClipboardListIcon, ['Dispatch → Pending Items lists everything ready to pack that is not yet on a packing list, grouped by project. A badge marks a project whose job card has reached the Dispatch stage.', 'Tick lines and use Create list from selected, or Add to the open draft list. Trade (SAS) lines show under their sale order. The list takes the project’s company (a trade list takes its sale order’s).', 'Each line shows its Item Master number (IM-…) and inventory number (INV-…); the search box finds lines by these numbers too. The same numbers show under each line on the packing list.', 'A line appears once Stores has routed it to Dispatch, or Production has handed it over.'], { outcome: 'Every ready item is on a packing list.', watchOut: "A line that has arrived but is still waiting for QC's inward review does not show here." }),
      feature('predispatch-approval', 'Approval before dispatch', ClipboardCheckIcon, ['When a packing list is Ready (packed), click Request approval on the packing list itself, or open Dispatch → Approvals and Submit it for review. Choosing Dispatched before approval offers to request it for you.', 'QC and Production each approve or reject. The row shows who has decided. If Production approved the items when handing them over, its part is already filled in.', 'Once both approve, set the list to Dispatched. If either rejects, fix the problem and Resubmit; the earlier decision stays on record.'], { outcome: 'The list is dispatched with both approvals on record.', watchOut: 'A list cannot be set to Dispatched without an approved review. Pulling a list back to draft cancels the review; submit it again after repacking.' }),
      feature('eway-freight', 'Invoice, e-way bill and freight', ReceiptIcon, [
        'Open the packing list. Linked Invoice: pick the issued sales invoice for this shipment. Freight: enter Freight Amount and Freight Paid By; when the company pays it, Post Freight Expense records it in the books (the amount can not be changed afterwards).',
        'E-way bill card: it lists what is needed before one can be generated (distance in km, transport mode, vehicle type, a linked issued invoice with HSN codes, the customer’s GSTIN, state, pincode and address, and the company’s place and pincode). Generate E-Way Bill sends it to the government system; the number, date and Valid Until are then shown. Cancel is possible within 24 hours with a reason.',
        'Generating needs the company’s e-way bill API credentials in Accounts → Company Entities. Until they are set up, type the e-way bill number and date by hand.',
        'Dispatch → Documents lists packed and dispatched lists with a Missing Invoice or Missing E-Way Bill.',
      ], { outcome: 'Every shipment has its invoice and e-way bill on record.', watchOut: 'An e-way bill is a legal document. Check distance, vehicle and invoice before generating.' }),
      feature('deliveries', 'Deliveries', TruckIcon, ['Dispatch → Deliveries lists dispatched packing lists. Awaiting Confirmation are the ones the customer has not acknowledged yet.', 'Carrier details opens the transport record (mode, LR / RR / BL / AWB number, vehicle, tracking link, expected delivery). Open the packing list to record the Delivery acknowledgment when the customer confirms receipt.'], { outcome: 'Every dispatched list ends with a confirmed delivery.', watchOut: 'There is no live tracking; the tracking link opens the carrier’s own page.' }),
    ],
    howTo: [
      { title: 'Create the list', body: 'Open Dispatch → Pending Items, tick the ready lines of the project, and add them to the open draft (or create a list). Lines Production handed over are already on the draft.' },
      { title: 'Pack physically', body: 'Open the draft in Packing Lists, arrange lines into loose, package and mounted groups, enter package labels and quantities, and check the physical count.' },
      { title: 'Complete the header', body: 'On the list enter customer and address, vehicle and carrier details, link the sales invoice, and enter the freight.' },
      { title: 'Get it approved', body: 'Set the list to Ready, then click Request approval on the list (or Submit it under Dispatch → Approvals). QC and Production each approve.' },
      { title: 'Dispatch', body: 'When both have approved, generate or type the e-way bill, print the PDF, and set the list to Dispatched. Reserved stock on it is issued automatically.' },
      { title: 'Confirm delivery', body: 'Open Dispatch → Deliveries and record the delivery acknowledgment on the list when the customer confirms.' },
      { title: 'Combine lists in one vehicle', body: 'Dispatch → Packing Lists → Combine lists: tick the lists going to the same address, then manage them under Shipments.' },
      { title: 'Issue and close out a Gate Pass', body: 'Dispatch → Gate Passes → New gate pass (Returnable or Non-returnable), get it Approved, then Issue it when the material leaves. For a returnable pass, tick each item as it comes back; the pass becomes Returned when all are ticked. An overdue pass shows a badge.' },
    ],
  },
  Installation: {
    title: 'Service', icon: MapPinIcon,
    intro: [
      'Service (the Installation department) tracks the work that happens at the customer site after manufacturing and dispatch. The project record should show what is planned, what the site team completed, and what is still waiting on the customer or another department.',
      'Use Operations for your open site work, Projects for the order record, Tasks for site-specific follow-ups, and the Service tab (Visits, Documentation) for site visits and commissioning / service reports. The Expenses tab holds your Cash Requests and Travel Allowance claims — they go to your Manager, then the Executive, then Accounts.',
    ],
    features: [
      feature('milestones', 'Site milestones', RouteIcon, ['Site Installation and Commissioning & Handover move by themselves from visits and the Commissioning report (see Milestone Tracker). To set a date or close one by hand, open the project → Service section, click the milestone and use Start or Close.', 'Closing late asks for a delay reason; the customer portal shows the same progress.']),
      feature('tasks', 'Site tasks', ListChecksIcon, ['Use tasks for access arrangements, foundation readiness, customer documents, travel, tools, and punch-list items.', 'Assign each task to a person or receiving department and include the project in the task.']),
      feature('handoff', 'Handoffs', MessageSquareIcon, ['Use cross-department tasks when Installation needs Dispatch, QC, Production, or Management to act. Close the task only after the receiving action is confirmed.', 'Keep customer commitments in the project record, not only in a private message.', 'Marking Commissioning & Handover complete is different from every other milestone close: there is no next department in the chain for it to hand off to, so it notifies Sales and every PM-tier account directly instead — the project is now fully done, not just past Installation.']),
      feature('progress', 'Customer progress', FolderKanbanIcon, ['The customer portal reads project progress from milestones. Accurate actual dates and delay reasons improve the customer view without extra reporting work.']),
      feature('visits', 'Visits', CalendarCheckIcon, [
        'Pick a project to see its site visits. Every project starts with four planned visits: foundation marking, customer needs / issue solving, pre-commissioning, and commissioning. Rename them, add more, or delete any.',
        'Each visit has a description, a date, a time, who from the team went, and a planned / done status. The header shows how many visits are done and how many remain of the planned number, which you can change per project.',
        'With no project selected you see every project with its planned, done and remaining visits — click one to open it.',
      ]),
      feature('documentation', 'Documentation', FileTextIcon, [
        'Service → Documentation: pick a project and a call type. Commissioning opens the full commissioning report; Breakdown, ASC and Other open the Field Service Report.',
        'Customer, site address, contact, model, capacity, pressures, maker\'s number and boiler type fill in from the project, Sales and QC records. Check them and edit anything that differs on site.',
        'Checklist tables come with every standard row listed; enter the observed value and OK / NG, remove rows that do not apply, or add your own. Total hours and days are worked out from the from and to times. Sign on screen with a finger (full screen on a phone).',
        'Finalize locks the report and gives a commissioning report its number (SB-COM-001…); Reopen unlocks it and the next finalize raises its revision. Download the PDF from the report.',
        'Share with customer puts a finalized report on the customer portal; the switch above the list shares every finalized report of that project. View as customer opens the portal as the customer sees it.',
        'Earlier customer remarks for the same project are shown at the top of a new report.',
      ]),
      feature('progress-photos', 'Progress Photos', CameraIcon, [
        'On a phone, tap the round camera button, take the photo, and a details sheet opens straight away: pick the project (it remembers your last one), a stage chip (Foundation, Erection, Piping, Electrical, Pre-commissioning, Commissioning, Issue / defect, Other), optionally the visit, and add remarks. The date, time and your name are stamped automatically.',
        'Photos are shrunk on the phone before upload, so they save quickly on site mobile data. Open a photo to change its stage, visit or remarks, or delete it. On a computer use Upload to add photos from a folder.',
      ]),
      milestoneTrackerFeature([
        ['Site Installation', 'Automatic', 'Starts with the first visit marked Done and completes when the done visits reach the planned number (Service → Visits). “Mark complete” on the project page still closes it by hand.'],
        ['Commissioning & Handover', 'Automatic', 'Starts when Site Installation completes and completes when a Commissioning report is finalized (Service → Documentation). Sales and managers are notified that the project is complete.'],
      ]),
      feature('expenses', 'Expenses: Cash Requests and Travel Allowance', ReceiptIcon, [
        'Open Expenses in the top bar. Cash Requests asks for an advance: purpose, amount and the customers it is for (pick a customer or type another name). It gets a CR number.',
        'Travel Allowance is the claim after a trip: place of visit (the customer), dates, travel, lodging, food and other entries, each with photos or PDFs of the receipts. It gets an EXP number. In Advance taken, click Link CR to set a cash request against the claim; an advance can be used in parts across claims.',
        'Approval: your Manager, then the Executive (both under Approvals → Service Expenses), then Accounts settles it (Accounts → Service Expenses). You are notified at each step. A rejected request needs a reason and is final; submit a new one.',
        'Open a request to see its status and download its PDF with the receipts attached.',
      ], { outcome: 'Every advance and claim is approved, settled and traceable to a customer visit.', watchOut: 'A request can not be edited after it is submitted. Check amounts and receipts first.' }),
      feature('requests', 'Requests: material for a site (PR and Trade Request)', InboxIcon, [
        'Open Requests in the top bar (the Service team’s own Requests screen). Purchase Requests raises a request for material: pick the item, quantity and project, and click Raise PR; it goes to Procurement.',
        'Switch the form to Trade Request to ask Sales to supply an item to a customer as a trade (SAS) order: pick the sale order or customer, add the items, and Send to Sales. Sales accepts it onto a SAS order.',
        'History has two tabs: PR for purchase requests and TR for trade requests, each with its status.',
      ], { outcome: 'Site material is requested through Procurement or Sales with a record.', watchOut: 'A trade request has no price; Sales prices the SAS order.' }),
    ],
    howTo: [
      { title: 'Plan the visits', body: 'Open Service → Visits, pick the project, and check its planned visits (four to start: foundation marking, customer needs, pre-commissioning, commissioning). Add or rename as needed.' },
      { title: 'Ask for an advance', body: 'Open Expenses → Cash Requests, enter purpose, amount and customer, and submit. It goes to your Manager, then the Executive, then Accounts.' },
      { title: 'Log a site visit', body: 'Open Service → Visits, pick the project, edit the visit that took place (date, time, who went) and mark it Done. Add a visit if an extra one was needed.' },
      { title: 'Take progress photos', body: 'Open Service → Progress Photos on the phone, tap the camera button, pick the project and stage, and save.' },
      { title: 'Write a report', body: 'Open Service → Documentation, pick the project and call type, fill the form, sign, and Finalize. Use the PDF button to share it.' },
      { title: 'Complete commissioning', body: 'Finalize the Commissioning report. That completes the Commissioning milestone and tells Sales and managers the project is complete.' },
      { title: 'Claim travel expenses', body: 'Open Expenses → Travel Allowance, enter the trip and attach receipts, link the cash request you took, and submit.' },
      { title: 'Manage a blocker', body: 'Raise a task to the right department from Operations (Raise on the Incidents card) or the project page, with the project and what is needed.' },
    ],
  },
  Sales: {
    title: 'Sales', icon: TrendingUpIcon,
    intro: ['Sales manages the commercial journey from qualified enquiry to confirmed Sale Order. The CRM keeps customers, contacts, quotations, and orders connected so the factory receives a clean handoff.', 'Sales owns Enquiries/Leads (list and Board), Customers, Quotations, Sale Orders, payments and its Reports. Marketing works in its own Marketing and Pipeline tabs.'],
    introFlow: {
      heading: 'From enquiry to money in the bank',
      subheading: 'The whole Sales journey on one page. Each box is where you click; each arrow is what the app does for you.',
      stages: [
        { boxes: [{ title: 'Enquiry', body: 'Sales → Enquiries → New Enquiry. Organization, contact, products, stage. Stage starts at Lead - Cold.' }], arrowNote: 'Add Diary notes as you call; move the Stage (or drag on Board).' },
        { boxes: [{ title: 'Customer', body: 'An enquiry becomes a customer the first time you Convert it, or click Create Commercial Offer / Create PO. If a similar customer exists you choose: use it, or create a new one. The enquiry stays where it is — it is only linked.' }], arrowNote: 'Create Commercial Offer' },
        { boxes: [{ title: 'Quotation', body: 'Lines from the Product Master with per-line GST. Send Email attaches the PDF; the enquiry moves to Hot Offers. A big discount needs the Sales Head to approve first.' }], arrowNote: 'Set the quotation to Accepted, then Convert to SO — or click Create PO on the enquiry.' },
        { boxes: [{ title: 'Sale Order', body: 'Items, discount, GST and charges in the order details (document icon). Design and PMs are notified. The enquiry moves to Order Received.' }], arrowNote: 'Design makes a Project from the order (Projects → New Project → pick the order).' },
        { boxes: [{ title: 'Payments', body: 'Order Tracker: stage, bill value and received per order. Payment Log: add each payment received. Unpaid orders remind their salesperson weekly.' }], arrowNote: 'Convert to Invoice on the quotation, or Invoices → Add Sales Invoice.' },
        { boxes: [{ title: 'Invoice & customer portal', body: 'Invoices tab: draft → issued → paid, Credit Notes for returns. Setup → Portal Access gives the customer a login to follow their order.' }] },
      ],
    },
    features: [
      feature('leads', 'Enquiries', UserPlusIcon, ['Capture the person/company, contact details, source, territory, and industry.', 'The funnel stage is the enquiry\'s only status. Open the enquiry and change its Stage as the conversation moves (Lead - Cold → Lead - Hot → Proposals → Hot Offers …). Order Received comes from Create PO and Order Lost from the Order Lost action, which also record the order or the reason.', 'Converting links the enquiry to a Customer record so quotations and orders can use it. It does not end the enquiry — it keeps its stage and keeps moving through the funnel.', 'Add every product the customer asked about under Products (on the New Enquiry form, or Products → Edit on the enquiry). Pick from the Product Master to fill the unit, price and GST %, or type a product that is not in the master yet. Saving products with rates sets the enquiry\'s Expected value to their total; you can still change the value by hand.', 'A/C Manager and Initiated by are picked from the Sales team. In Add to Diary, Plan Action Type records how the next follow-up will happen (call, email, meeting, other). Alert "All seniors" notifies the Sales Heads; "Selected seniors" notifies the people you tick; the "Plan of Action for" person gets a follow-up notice. SMS alerts are not available yet.', 'A Sales Executive sees only their own enquiries, quotations and orders (where they are A/C manager, assignee or creator); a Sales Head sees everything. Set this in Settings → Access Matrix → Responsibility.', 'Home calendar: Diary follow-ups (the Next plan date on a Diary entry) show as blue pills, and the Follow-ups panel beside the calendar lists today\'s and the next 7 days\' follow-ups with an Update button. Clicking a day shows its follow-ups as a table; Update Now opens the Diary right there; New Enquiry opens the enquiry form without leaving Home.', 'Create PO books the order and moves the enquiry to Order Received (the won stage) unless you pick another stage; the new customer keeps the enquiry\'s address, pin code, district, website and A/C manager.', 'Older enquiries carried over from earlier records show a Closed badge and stay as history on the customer; they are not on the board or in the funnel. Only the Sales Head sees an enquiry with no A/C manager until one is assigned.']),
      feature('pipeline', 'Board', TrendingUpIcon, ['The enquiry is the deal — there is no separate opportunity record in Sales. Open Leads and switch to Board to see every enquiry as a card in its funnel stage, with the stage\'s count and value.', 'Drag a card to move it. Dropping on Order Received asks you to use Create PO (which records the order); dropping on Order Lost asks for the reason.', 'Keep each enquiry\'s Expected value current — it drives the Board totals, the funnel report and the Executive pipeline.', 'Creating a Commercial Offer from an enquiry that is still before Hot Offers moves it to Hot Offers automatically. It never pulls a won or lost enquiry back.']),
      feature('customers', 'Customers and contacts', Building2Icon, ['Keep the commercial party, people, and addresses in one place. Reuse these records in quotations and orders instead of creating near-duplicates.', 'When you type a new customer or enquiry organization, the app lists existing customers that look the same (similar name, same GST No or phone). When an enquiry is linked to a customer and such a match exists, you choose: use the existing customer, or create a new one.', 'Some customers show an Account Summary block: organization code, A/C manager, district, products asked about, sales calls by stage, and quoted / ordered / collected totals. Search the list by name, code, GST, phone, district or A/C manager.', 'Use the company dropdown in the top bar (All / Shanti Boilers / Shanti Techno Fab) to see one company\'s orders, quotations, invoices and payments. It also narrows returns, Scope of Supply, Customer 360 and the Sales reports, and a report\'s company buttons offer only the chosen company. Other departments always show both companies. A spinner shows while the page reloads. With All companies, each order and payment has a small SB / STF tag. New orders and quotations start in the selected company. Customers, products, suppliers and stock are shared by both companies.', 'A Sales team member sees their own enquiries (as A/C manager, assignee or creator) and the quotations, orders and payments that belong to them. The Sales Head sees everything, including the imported historical orders.', 'Open a customer to see Customer 360: its enquiries, quotations, orders with payments received and outstanding, invoices, projects, service calls and contracts, Diary, and the installed base with each item\'s warranty (counted from delivery or installation on its project). "Open in Reports" opens a Sales report filtered to that customer.', 'Competitors: add who else quoted (and at what price) on the customer, or record "Lost to competitor" when marking an enquiry Order Lost. Reports → Competitor Analysis totals them.']),
      feature('quotations', 'Quotations', FileTextIcon, ['Build the proposal with real line items, rates, taxes/terms as applicable, then generate the PDF. Convert an accepted quotation to a Sale Order.', 'Lines come from the Product Master: search while typing and pick a product to fill its unit, rate, HSN and GST %. Everything stays editable, and a line can be typed free-text. Create Commercial Offer on an enquiry starts with that enquiry\'s products already filled in.', 'Each line has its own GST %; a line left blank uses the Default GST %. On save the tax is split into CGST + SGST when the customer is in the same state as the company, otherwise IGST — the PDF shows the split. An order or invoice made from the quotation keeps each line\'s GST % and discount.', 'Revise a quotation (not yet accepted) to change prices or lines: it opens pre-filled and saves as R1, R2 … of the same number; the old one is marked Revised.', 'A line discount above the Sales Head\'s limit (shown on the Quotations tab, 10% unless changed) needs the Head\'s approval before the quotation can be sent or accepted. The Head is notified and approves from the Quotations tab.', 'Needs follow-up lists sent quotations that expire within 3 days, have expired with no order, or were sent 7+ days ago with no Diary activity. The enquiry\'s A/C manager gets a reminder notification for each (once per reason). Marking a quotation Sent records the date the 7-day count starts from.']),
      feature('sale-orders', 'Sale Orders', ShoppingCartIcon, ['Create PO from an enquiry opens the order form. Items On Order is a table (Product Code, Description, Warranty Std / Accepted, From Date Of D/I, Inst Req, Preventive Maintenance, Qty, Unit Price, Disc %, Tax %, Total Price) filled in from the quotation, or from the enquiry\'s products when there is no quotation — check it and Save. The order discount can be a % or an amount. Totals update as you type.', 'Our GST No, Entity Code and PAN, the customer\'s Customer Code, PAN and GST No, and the SOS No are shown read-only on the order and its PDF. Change them in Company Settings or the customer record. The SOS No appears once Design converts the order to a Project.', 'Order Stage is a funnel stage and A/C Manager is picked from the Sales team. Imported orders keep their old Sales Person name, shown as "(not a user)".', 'The Sale Order is the confirmed commercial order. Linking it to a Project creates the Design/Engineering Scope of Supply handoff.', 'Sales does not create the project. Design is notified of every new order and creates the project from Projects → New Project by picking the order; you are notified when that happens.', 'Request Stores (shown only on SAS trade orders) raises a trade request straight to Stores\' queue — describe the item and quantity, and Stores sees it immediately.', 'Projects → New Project → Sale Order: search by order number or customer. Picking an order fills the customer, company, order date and a description from its lines; the order\'s lines become the Scope of Supply (with HSN/GST). An existing project\'s order is changed from Edit Project. Orders already on a project show "on SB-xxxx".', 'Give a product a BOM structure template (Masters → Products) and every project made from an order with that product starts its BOM tree from it — Engineering then adjusts sizes and quantities.', 'Techno Fab orders and payments (85 orders, 257 payments, 2024-26) are loaded; pick Shanti Techno Fab in the company selector to see only them. Existing Shanti Boilers and Techno Fab projects are linked to their orders (the 50 SB-1109 units each to their own order).']),
      feature('costing', 'Costing', IndianRupeeIcon, [
        'A "Costing" button appears on a Sale Order once it has a linked Project — before that there is no real BOM, PO, or labor data to cost against, so nothing shows.',
        'Shows the quoted value against real actual cost: issued-PO spend (draft/cancelled POs don\'t count) plus logged job-card labor time. It updates live as Procurement issues POs and Production logs hours — check back rather than treating one look as final.',
        'This is actual cost, not an estimate — there is deliberately no pre-sale cost prediction on the Quotation itself yet, since no real cost data exists before a Project does.',
      ], {
        value: 'A quoted margin only means something once it is checked against what the job actually cost. Without this, that comparison meant pulling PO totals and labor hours by hand, project by project.',
        outcome: 'You can see, at any point after Sale Order conversion, whether a job is tracking to the margin it was quoted at — before it is too late to do anything about it.',
        checklist: ['Treat an early-stage margin (little PO/labor data logged yet) as incomplete, not as a final number.', 'A negative margin shown in red is worth a real look, not a shrug — it means actual cost has already passed the quoted value.'],
        watchOut: 'Material cost only counts what Procurement has issued a PO for — approved-but-not-yet-ordered BOM demand is invisible here, same as it is everywhere else in the app that reads issued spend.',
      }),
      feature('weekly-planner', 'Weekly Planner', ListChecksIcon, ['Enquiries → Weekly Planner shows one week of planned follow-ups (the "next plan" dates from the Diary), day by day. Change a date to move a follow-up. The Sales Head can also pick another person to hand it over; they get a notification.', 'The red Overdue box lists follow-ups whose date has passed and where nothing has been logged since. Log a Diary entry on the enquiry and it leaves the list.']),
      feature('amc', 'AMC and preventive maintenance', WrenchIcon, ['Deals → AMC lists service contracts with days committed and left, visits done, value, amount received, cost booked and profit. Open a contract to choose its service engineer, log each payment received (date, amount, who took it), add cost entries (spares, travel), renew or cancel it. The AMC Due, AMC Received and Service Engineer wise reports are built from these.', 'Preventive maintenance due lists the next visit for each active contract (from its "every" setting) and for items still under warranty that have a maintenance schedule. Schedule visit puts it on the Home calendar for the Service team.', 'Customer 360 also shows an Offer an AMC button when a customer bought equipment but has no active AMC, and the Enquiries list has an AMC enquiries filter.']),
      feature('team-settings', 'Settings and Team', UsersIcon, ['The Settings page (cog icon, Sales Head or a manager) has a Sales section with Team, Email, WhatsApp, Lead sources and Data retention. Portal Access stays under Sales → Setup for everyone in Sales.', 'Team: Add member picks someone HR has already put in the Sales department and gives them a username and password. Change a person between Member and Head, Reset password (a new password is shown once — share it with them), or Switch off. You can not change your own role, and people who also have another department are managed by a PM.']),
      feature('library', 'Library', FileTextIcon, ['Setup → Library keeps mailers, presentations and price lists in one place for the whole team. Upload a file with a title and category; anyone in Sales can download it. The uploader or the Sales Head can delete it.']),
      feature('mis-reports', 'MIS reports', BarChart3Icon, ['Reports → Sales is grouped by what you want to know (Overview, Sales Order / AMC Order, Funnel & Enquiries, Order Analysis, Sales Calls & Follow-up, Quotations & Pricing, Team Performance, Customers & Feedback). The management reports include: Employee, Source, Reference and Branch Wise Order, Order Win/Loss, Funnel Ageing, Order Time Cycle, Lead Generation, Call Log, Last Contact, Employee Daily Work, Employee Movement, New Customer Added, Selling vs Cost Price, Employee Usage and AMC Profitability. Each has a date range and downloads as CSV or Excel. Sales Order vs Collection (formerly Order Book & Collections), the Dispatch Sales Order Report and the three AMC reports (Customer Wise Monthly AMC Due, Customer Wise Monthly AMC Received, Service Engineer wise AMC Received) are under Sales Order / AMC Order.', 'Employee Movement is the Diary visit log (place, in and out times), not GPS. Selling vs Cost Price, Employee Usage and AMC Profitability are for the Sales Head only.']),
      feature('payment-tracker', 'Order Tracker and Payment Log', IndianRupeeIcon, ['Sales → Payments → Order Tracker lists every order with its value, what has been billed and what has been received. Pick the Current Stage from the dropdown (Advance → Dispatched → Site Work Completed → Commissioning → Pending Site Issue → Cleared Issue → Completed); the stage shown is the next step still to do, as in the old Excel tracker.', 'Bill Value is the total of the order\'s issued or paid Sales Invoices. Until an order has one, you can type the billed amount into Bill Value yourself.', 'A row turns light green when Payment Received equals the Order Value (within ₹1 for rounding), light yellow when the amount short looks like TDS kept back by the customer (0.1%, 1% or 2% of the order value, or of the value before GST), and light red otherwise — for example nothing paid yet, a part payment, or more paid than ordered. Bill Value is for information only and does not change the colour. A row has no colour until it has an order value.', 'Click a remark (or "Add remark") to write it in a larger box. The cog on the Orders card sets your own row colour rules. Sales → Payments → Payment Log is the log of every payment received: Add payment records one against an order, and the order\'s owner is notified.']),
      feature('email-setup', 'Email and Portal Access', MailIcon, [
        'Settings → Sales → Email (Sales Head; everyone else sees "My Email" under Setup) holds the sending mailbox for each company (Zoho address + app password), your own optional mailbox, a Test / Live switch and the list of recent emails. Keep it on Test until a test email has arrived; in Test mode nothing reaches a customer.',
        'Setup → Portal Access (everyone in Sales) lists customers with a project. Enable creates their login. The username is the first word of the organization name; the first password is the customer\'s phone number, which they must change at first sign-in, or a set-password link when no phone is on record. Each row has Reveal, Copy and Reset for the password, Copy link, and Open portal, a read-only preview of what the customer sees.',
        'A quotation sent by email carries its PDF and is marked Sent only when the email really went out.',
        'Payment reminders: an order from the last year that is still unpaid after 30 days sends its salesperson a notification once a week.',
      ]),
      feature('returns', 'Returns', UndoIcon, [
        'Raise a return against a Sale Order with the item, quantity, and reason. It starts pending — nothing else happens until someone inspects it.',
        'Move Inspection to accepted or rejected. Only accepted returns unlock a stock action: Restock (pick which inventory item it credits, adds the returned quantity straight to On-hand) or Scrap (no stock effect).',
        'Credit note is a plain reference field — type the number once Accounts issues it. This app does not generate or post the credit note itself.',
      ], {
        value: 'Returned material that never gets logged either vanishes from the record entirely or quietly reappears in stock with no trace of why — neither is acceptable when a customer disputes what came back.',
        outcome: 'Every return has a reason, an inspection decision, and — if it goes back on the shelf — a real stock movement tied to the specific inventory item it credited.',
        checklist: ['Don\'t restock before Inspection is actually accepted — the stock action is deliberately locked until then.', 'Pick the real inventory item the material matches, not a close-sounding one — the on-hand credit lands on whatever you pick.'],
        watchOut: 'Restock only ever adds quantity once — re-picking a different inventory item afterward does not move the credit, it was already applied to the first one.',
      }),
      feature('notifications', 'Notifications', BellIcon, [
        'You do not get a notification for your own Sale Order the moment you create it — that one goes to Design and every PM-tier account (admin/manager/executive) instead, so they know a new order exists even before it becomes a Project. Check the Sale Orders list to confirm it saved; the bell is not the confirmation for your own action.',
        'You receive a notification when a Sale Order is converted to a Project. A Design Head (or a PM) does the converting, so this is how you find out the commercial-to-technical handoff actually happened without asking. Every PM-tier account gets the same notification at the same time.',
        'You send a notification to Stores every time you use Request Stores on a SAS Sale Order. It lands in Stores\' Requests queue immediately, the same way one they raise themselves would — there is no separate inbox and no delay.',
        'You receive a notification when a project reaches Commissioning & Handover — the very last milestone in the chain, closed by Installation. Every other milestone hands off to a specific next department, but there is nothing after Commissioning, so this is fired directly to Sales and every PM-tier account instead of the usual handoff mechanism. It is the one place Sales learns a project it sold is actually, fully done.',
        'This is the same bell every internal department uses, top right of the app. It is automatic for everyone with Sales access; nothing here is a toggle you turn on or off.',
      ], {
        value: 'These notifications exist so the Sale Order → Project handoff, and the project\'s eventual completion, are never a silent, out-of-band ask. Sales finds out the moment its own commercial work becomes technical work, the moment a new order exists, and the moment the whole thing is finally delivered — without checking someone else\'s screen for any of the three.',
        outcome: 'Every event that matters to Sales across a project\'s full lifecycle — creation, conversion, a SAS push, and completion — reaches the right people through the bell, with enough context to act without asking who sent it.',
        checklist: [
          'Do not assume silence means nothing happened — your own Sale Order creation intentionally does not notify you; check the list instead.',
          'Follow a "converted to Project" notification straight into the Project record rather than acting from the title alone.',
          'When you raise a SAS request, describe the item and quantity well enough that Stores can act on the notification without replying to ask what you meant.',
          'Treat a "project complete" notification as the cue for whatever closing-the-loop step is yours to own — a customer call, final paperwork, a handover confirmation — not just a status update to note and move past.',
        ],
        watchOut: 'Marking a notification read only proves you saw it. A "converted to Project" notice still means the commercial note or task you owe Design/Engineering needs to actually be added to the new Project.',
      }),
      feature('tasks', 'Diary and follow-ups', PhoneIcon, ['Log the outcome and next step of every call or visit in the enquiry\'s Diary, with the next follow-up date. Follow-ups show on your Home calendar, so there is no separate Tasks list in Sales.', 'The sidebar follows the day: Enquiries (Enquiries, Weekly Planner, WhatsApp, Trade Requests, Customers), Deals (Quotations, Sale Orders, AMC), Payments (Order Tracker, Payment Log, Invoices, Returns), then Setup (Library, Portal Access, Masters: Products, Funnel Stages, Targets, Branches, Email Templates).']),
      feature('reports', 'Reports', BarChart3Icon, ['Sales Pipeline shows every funnel stage in order with the number of open enquiries and their expected value (closed sales calls are left out); Agent Performance and Lead Funnel show the same enquiries by person and by stage.', 'Sales Order vs Collection is the Sales Head\'s money view of every order (both trackers plus new orders): orders booked, order value, received, outstanding and collected % for a financial year; booked (by company) and collected per month; outstanding by age; top customers still owing; value by sales person and by order status; and a details table by customer, sales person, status or company. Pick the company at the top of the app to see one company only.', 'Sales Overview shows this month\'s orders against target, the open funnel value and its weighted forecast, quotations waiting on a follow-up, and a six-month trend.', 'Employee Performance 360 shows one A/C manager or the whole team for chosen months: enquiries, sales calls, planned vs actual follow-ups, quotations, orders, win rate, target achievement, average days per stage, expenses and cost per order. Click a team row to open that person.', 'Sales Call Funnel: Value is the total Expected value of the enquiries at each stage; Probability (Value) weights it by the stage\'s win % (set by a Sales Head in Masters → Funnel Stages). Click a count to list the enquiries, with their latest quotation; hover a row to see the last Diary entry.', 'Every Sales report downloads as CSV or Excel (exactly the rows on screen, with full amounts) or prints to PDF. A Sales Executive\'s reports cover only their own records.', 'Data retention (Sales Head): under Settings → Sales → Data retention, choose how long follow-up notes and enquiry stage history are kept (1 month to 5 years) and switch it on. Nothing is deleted by switching it on or changing the window; you are shown what is past it, download a backup workbook, then confirm. Each enquiry\'s latest follow-up and stage, planned follow-ups, and all quotations, orders, invoices and payments always stay, and deleted history does not come back if you later extend the window.']),
      feature('agent-performance', 'Agent Performance', UserRoundIcon, [
        'Reports → Sales → Agent Performance shows, per person, the enquiries they own, how many became orders, follow-ups planned and done, and the value won.',
        'An enquiry belongs to its A/C Manager, else its assignee, else whoever created it. Won value follows the same person. Closed historical sales calls are left out.',
        'Average response time is the gap between an enquiry being created and its first Diary entry; treat it as a rough signal.',
      ], {
        value: 'Other reports look at the funnel as a whole. This one shows who is carrying the work.',
        outcome: 'You can see, per person, how much is on their plate and how it converts.',
        checklist: ['Set the A/C Manager on every enquiry so it counts for the right person.', 'Use Employee Performance 360 for the fuller picture of one person.'],
        watchOut: 'A person with no enquiries does not appear in the table.',
      }),
      feature('trade-requests', 'Trade Requests', InboxIcon, ['Sales → Enquiries → Trade Requests lists items the Service team has asked Sales to supply to a customer as a trade (SAS) order.', 'Tick the requests that belong together and Accept. The app creates the next SAS sale order with one line per request, at rate 0, and tells the people who raised them. If a request does not name a sale order, pick the customer first.', 'Open the new SAS order in Sale Orders to enter rates, then use Request Stores so Stores can reserve or buy the material.'], { outcome: 'Each accepted request sits on a SAS order with a customer.', watchOut: 'Rates start at 0. Enter them before sending the order to the customer.' }),
      feature('masters-targets', 'Targets and Branches', TagIcon, ['Sales → Setup → Masters → Branches is the list of offices or locations offered on enquiries and sale orders.', 'Masters → Targets holds the monthly sales target for a branch or an account manager. Reports compare booked orders with these targets.', 'Only a Sales Head or a manager can change them.'], { outcome: 'Enquiries and orders carry the right branch, and reports have a target to compare with.', watchOut: 'A target set for the wrong month or person makes the report misleading. Check the month before saving.' }),
      feature('email-templates', 'Email Templates', MailIcon, ['Sales → Setup → Masters → Email Templates holds the wording of the Commercial Offer email, one per company: terms, commercial and bank details, signature.', 'Use the token buttons to insert the customer name, quotation number and amount; the preview shows the result.', 'The template is used whenever a quotation is emailed. The sender can still edit the message before sending.'], { outcome: 'Every offer email from a company starts from the same approved wording.', watchOut: 'A change applies to every future email of that company, not to ones already sent.' }),
      feature('order-lost', 'Order Lost and competitors', AlertTriangleIcon, ['To record a lost order: open the enquiry, choose Order Lost, pick the reason and, if you know it, the competitor it was lost to, their product and price.', 'The enquiry moves to the Order Lost stage and leaves the open funnel. On the Board, dropping a card on Order Lost opens the same dialog.', 'Reports → Competitor Analysis and Order Win/Loss read these entries.'], { outcome: 'The enquiry is closed as lost with a reason, and the loss shows in the reports.', watchOut: 'A lost enquiry cannot be quoted again. Create a new enquiry if the customer comes back.' }),
      feature('whatsapp', 'WhatsApp inbox and connection', MessageSquareIcon, ["To connect WhatsApp: Settings → Sales → WhatsApp (Sales Head or a manager). Follow the numbered steps and paste the phone number ID, access token and app secret from the company's Meta business account. One number per company.", "Sales → Enquiries → WhatsApp is the inbox. A new conversation goes to the enquiry's account manager when the phone number matches, otherwise to the next person in the rota.", "You can type freely within 24 hours of the customer's last message. After that, send one of the approved templates.", 'Quotations and RFQs have a WhatsApp button; if the company number is not connected it opens WhatsApp on your own phone or computer instead.'], { outcome: 'Customer messages reach the right salesperson and replies go from the company number.', watchOut: "Meta bills the company's card for messages; there is no prepaid balance to top up here." }),
      feature('invoices', 'Invoices and Credit Notes', ReceiptIcon, [
        'Sales → Payments → Invoices lists Sales Invoices and Credit Notes. Create one with Convert to Invoice on an accepted quotation (its lines, discounts and GST carry over) or Add Sales Invoice.',
        'An invoice starts as a draft. Setting it to Issued gives it the company’s invoice number, posts it to the books and tells managers; the customer sees it on their portal. Paid is set when the money is in: Sales, or Accounts recording the receipt.',
        'Credit Note on an invoice records an amount given back, for example for a return. The PDF button prints the invoice with the CGST + SGST or IGST split.',
      ], { outcome: 'Every billed amount is an issued invoice with its GST split and payment status.', watchOut: 'An issued invoice is in the books. Correct it with a credit note, not by editing.' }),
      feature('products', 'Products (Product Master)', TagIcon, [
        'Sales → Setup → Masters → Products is the list of what you sell. Each product has a code, name, category, unit, price, cost price, HSN code, GST %, warranty days and whether it is serviceable.',
        'Search and page through the list. Open a product to edit it; the dialog also shows its price history, added to each time the price or cost changes.',
        'Products fill in the lines of enquiries, quotations and sale orders. A product can be linked to a BOM Structure Template.',
      ], { outcome: 'Quotation lines start with the right unit, price, HSN and GST.', watchOut: 'A product with no HSN code or GST % gives an invoice line that has to be completed by hand.' }),
      feature('lead-sources', 'Lead sources (IndiaMART, TradeIndia, JustDial, website)', InboxIcon, [
        'Settings → Sales → Lead sources (Sales Head, Marketing Head or a manager): connect IndiaMART (CRM key), TradeIndia (user id, profile id and key), JustDial or a website form (they push to the address shown).',
        'Each lead becomes an enquiry at the first stage with its source set, assigned by the team rota; the assignee is notified. A lead from a phone number that already has an open enquiry is added to that enquiry’s Diary instead.',
        'Leads are collected while anyone has the app open; Sync now pulls at once and shows the provider’s error if a key is wrong.',
      ], { outcome: 'Portal leads arrive as enquiries without retyping.', watchOut: 'A lead with neither phone nor email is skipped.' }),
    ],
    howTo: [
      { section: 'Sale Order', title: 'Capture an enquiry', body: 'Open Sales → Enquiries → New Enquiry. Enter the organization, contact, source and the products asked about, and pick the A/C Manager. Log the first call in the Diary with the next plan date.' },
      { section: 'Sale Order', title: 'Qualify it', body: 'Log calls/notes in the Diary, confirm requirement and timing, and move the Stage forward (Lead - Hot, then Proposals) when it is a real opportunity.' },
      { section: 'Sale Order', title: 'Create the commercial record', body: 'From the enquiry, use Create Commercial Offer: it links the customer, builds the Quotation with real line items, and generates the PDF.' },
      { section: 'Sale Order', title: 'Confirm the order', body: 'Set the quotation to Accepted and click Convert to SO, or click Create PO on the enquiry. Check the items, discount, GST and customer details in the order and save.' },
      { section: 'Sale Order', title: 'Hand off cleanly', body: 'Attach the Order Acknowledgement PDF to the Sale Order. Design is notified and creates the project from Projects → New Project. Add any commercial note Design must know as a task.' },
      { section: 'Sale Order', title: 'Invoice and collect', body: 'On the accepted quotation click Convert to Invoice, or use Sales → Invoices → Add Sales Invoice. Set it to Issued. Log each payment in Sales → Payment Log.' },
      {
        section: 'SAS material request', title: 'Request material for a SO', body: 'Open Sale Orders, use Request Stores on the SAS order, and describe the item and quantity. This goes to Stores as a trade (SAS) request against that Sale Order.',
        why: 'Material sometimes needs to move before a Project exists — a SAS request lets Stores act on it without waiting for the full handoff.',
        verify: 'The item description and quantity are specific enough for Stores to act on without asking you to clarify.',
      },
    ],
  },
  Marketing: {
    title: 'Marketing', icon: MegaphoneIcon,
    intro: ['Marketing creates demand and tracks which campaigns and sources produce useful enquiries.', 'Marketing has three screens in the top bar: Marketing (Campaigns), Pipeline (Marketing’s own opportunities) and Reports. Enquiries, customers, quotations and orders belong to Sales and are worked in the Sales screen.'],
    features: [
      feature('campaigns', 'Campaigns', MegaphoneIcon, ['Open Marketing in the top bar. New Campaign adds a campaign for a trade show, referral drive, website push or other source of enquiries. The list shows each campaign’s status and owner.', 'Use the same campaign name on the enquiries and opportunities it produced so Reports can show its results.']),
      feature('pipeline', 'Pipeline (opportunities)', TrendingUpIcon, ['Open Pipeline in the top bar. New Opportunity records a prospect Marketing is developing: title, customer (optional), source, value, next contact date and notes.', 'Drag a card between stages as the conversation moves. Give a lost reason when an opportunity ends.', 'When a prospect is ready to be quoted, hand it to Sales, who work it as an enquiry.']),
      feature('lead-sources', 'Lead sources', InboxIcon, ['Settings → Marketing · Lead sources (Marketing Head): connect IndiaMART, TradeIndia, JustDial or a website form. Each lead becomes a Sales enquiry with its source set, so Leads by Source can count it.', 'Sync now pulls leads at once and shows the provider’s error if a key is wrong.'], { outcome: 'Portal leads reach Sales with the right source.', watchOut: 'A lead with neither phone nor email is skipped.' }),
      feature('reports', 'Marketing reports', BarChart3Icon, ['Open Reports in the top bar: Lead Funnel, Leads by Source and Campaign Performance compare campaign activity with enquiry volume and value.', 'Each report downloads as CSV or Excel. Reports are only as good as the source and campaign set on each enquiry.']),
      feature('tasks', 'Tasks and follow-up', ListChecksIcon, ['Add follow-ups for campaign responses, callbacks and event contacts on Home → Tasks, with a due date.', 'To ask another department for something, use Raise on the Operations Incidents card.']),
    ],
    howTo: [
      { title: 'Plan a campaign', body: 'Open Marketing → New Campaign and give it a clear name before the enquiries arrive. Use the same name everywhere.' },
      { title: 'Connect a lead source', body: 'Open Settings → Marketing · Lead sources, paste the key for IndiaMART or TradeIndia, and click Sync now to test it.' },
      { title: 'Track a prospect', body: 'Open Pipeline → New Opportunity. Keep the stage, value and next contact date current.' },
      { title: 'Review results', body: 'Open Reports and compare Lead Funnel, Leads by Source and Campaign Performance. Fix missing sources before drawing conclusions.' },
      { title: 'Hand off a ready deal', body: 'Tell Sales with a task (Operations → Raise) naming the customer and requirement; Sales creates the enquiry and the quotation.' },
    ],
  },
  Accounts: {
    title: 'Accounts', icon: LandmarkIcon,
    intro: [
      'Accounts owns the full books of each company — chart of accounts, journal entries, GST compliance, and the derived Trial Balance/P&L/Balance Sheet. SB Ops is the system of record here, not a document trail feeding an external accounting package; Tally, if ever connected, would be an optional sync target reading from this ledger, not the other way round.',
      'Most of the ledger fills itself in: issuing a Sales Invoice, approving a Vendor Bill, raising a Credit/Debit Note, or marking a Salary Slip paid each post their own journal entry automatically. Your day-to-day work is mostly settlement (receipts/payments), GST compliance (returns and reconciliation), and the exceptions nothing else already covers (Manual Journal Entry, bank reconciliation).',
      'Operations has a glance view now (the same kind of pipeline diagram Procurement, Sales, Design, and Stores already have) — but Accounts isn\'t one pipeline, so it shows three independent spines instead: Purchase → Pay (Bill Draft → Approved → Paid, with Debit notes off to the side), Order → Cash (Invoice Draft → Issued → Paid, with Credit notes off to the side), and Period Close (JE Draft → Posted → Reconciled, with GST returns filed off to the side). All three read live off the ledger; there is nothing to enter here.',
    ],
    features: [
      feature('settings', 'Company details', Building2Icon, ['Company Entities → Registration card. It shows GSTIN, PAN, legal name, registered address, state code and invoice series prefix for the company chosen in the top bar. Edit changes them by hand; Refresh from GST fetches them. Every document number and every GST split (CGST+SGST or IGST) is computed from this record, so keep it accurate.']),
      feature('company-documents', 'Company details and logo on documents', FileTextIcon, [
        'Choose the company in the top bar, then Company Entities. The Logo and documents card holds the logo; its Document details and design button opens a separate page with the document text and header design. This is the one place for what prints on every document of that company: name, address, phone, contact details, short code and logo. Save, and the next PDF anyone opens uses it.',
        'Logo: Upload logo accepts any image (PNG, JPG, WebP, SVG). A crop box opens first: drag it or its corners to keep only the part you want, check the purchase order header preview below it, then Save logo. Crop re-opens the saved logo for another trim.',
        'A wide logo that already contains the company name is printed alone at the top of the purchase order. A square mark gets the company name beside it. The QC folder header shows the logo beside the company name.',
        'Document headers (on the Document details and design page): pick a document from the dropdown, then choose where the logo sits (none, left, centre, right), the title font and size, and the footer. The footer is built from blocks you switch on (Address, Phone, Email, Website, GSTIN, taken from Document details) plus an optional extra line. Each document keeps its own design; a dot in the dropdown marks the ones you changed. QC statutory forms, the nameplate sticker and stock tags keep their fixed layout.',
        'A company with no logo prints the plain name and address header. Remove takes a logo off again.',
        'Short code is the letters in numbers such as quotation numbers and the SB / STF tags. Maker\'s number prefix decides which company a QC folder is filed under.',
      ], {
        outcome: 'Every document of the company shows the same, current name, address, contacts and logo.',
        checklist: [
          'Use a logo with a transparent background, at least 400 px on its shorter side.',
          'After saving, open one purchase order PDF and one quotation PDF to check the header.',
          'Leave "Name on QC forms" and "Address on QC forms" blank unless the statutory forms must show a different wording.',
        ],
        watchOut: 'A change here affects every document printed afterwards, including reprints of old ones. Documents already downloaded or sent are not changed.',
      }),
      feature('rates', 'GST & TDS Rates', PercentIcon, ['HSN → GST rate and TDS section → rate/threshold masters, effective-dated like Payroll’s own statutory rates. A rate with no row here falls back to whatever flat percentage the originating document typed by hand — add the real rate before trusting an automatic split.']),
      feature('ledger', 'Chart of Accounts & General Ledger', LayersIcon, ['Accounts → General Ledger holds the Chart of Accounts, the Books lock date (no posting on or before it), Manual Journal Entries, AR / AP settlement, and the Trial Balance, Profit & Loss and Balance Sheet. Each company’s chart is seeded with the accounts every auto-posting trigger needs (AR, AP, GST Input/Output, Raw Material Inventory, Salary Expense, and the rest) — add an account only when a real new use needs one, not speculatively.', 'Trial Balance, Profit & Loss, and Balance Sheet are read-only rollups off the ledger, not separate records — if they look wrong, the fix is always in what posted to the ledger, never in the report itself.']),
      feature('journal', 'Manual Journal Entry', FileEditIcon, [
        'Accounts → General Ledger → Manual Journal Entries. Use this only for what no document already covers — every Sales Invoice, Vendor Bill, Credit/Debit Note, Salary Slip, receipt, payment, and Material Issue posts itself. A Manual Journal Entry is for a real adjustment nothing else models.',
        'A new entry saves as a draft and does not touch the Trial Balance until you Post it — debits and credits must match before it can be posted at all. Once posted it is immutable; a mistake is corrected with Reverse, which posts a new offsetting entry, never an edit to the original.',
      ], {
        outcome: 'The adjustment is posted, the Trial Balance still balances, and anyone reading the ledger later can see exactly what was entered and why — never a silent edit to history.',
        checklist: [
          'Confirm this adjustment genuinely isn’t already covered by an existing document flow before typing it by hand.',
          'Add every line with the correct account and amount; the draft won’t let you Post until total debits equal total credits.',
          'Post only once you’re sure — a posted entry is immutable. Found a mistake after posting? Reverse it, then post the correct entry.',
        ],
        watchOut: 'A posted entry cannot be edited or deleted, on purpose — that immutability is what makes the ledger trustworthy. If a posted entry is wrong, reverse it and post the correct one; do not go looking for a way around the lock.',
      }),
      feature('settlement', 'AR / AP settlement', ReceiptIcon, ['Accounts → General Ledger → AR / AP settlement: record a customer receipt against an issued Sales Invoice or a vendor payment against an approved Vendor Bill — pick the real document from the list, not a free-text reference. Each one posts Bank & Cash against Accounts Receivable/Payable and moves the parent document to Paid once it is genuinely fully settled.', 'A receipt or payment cannot exceed the real balance still due — the amount is checked against everything already recorded against that document, not just typed and trusted.'], {
        outcome: 'Accounts Receivable/Payable reflects real cash movement, not just document status — the invoice or bill shows Paid only once it genuinely is.',
        checklist: [
          'Pick the real invoice or bill from the list — not a typed reference — so the receipt/payment links to the document it actually settles.',
          'Enter the amount actually received or paid; a partial settlement is fine and keeps the document open until the balance reaches zero.',
          'Check the document flipped to Paid once the balance is fully settled — if it didn’t, the amount entered was short.',
        ],
      }),
      feature('gst-returns', 'GST Returns', FileTextIcon, [
        'Outward: GSTR-1 (or IFF, the same report, filed monthly instead of quarterly under QRMP) is generated live from issued Sales Invoices for the period you pick — B2B and HSN summaries, nothing to re-key.',
        'Inward: upload the GST portal’s own GSTR-2B download for the period; add a manual line only for a genuine exception the upload didn’t capture. Accept or reject each line under IMS — an untouched line is deemed accepted on the portal before the GSTR-3B due date, so don’t leave one sitting on Pending by habit.',
        'GSTR-3B nets GSTR-1’s outward tax against ITC Reconciliation’s eligible ITC automatically — check that reconciliation, not just the GSTR-3B number, if the net payable looks wrong.',
      ], {
        outcome: 'The period’s outward and inward GST position is correct and traceable before anyone files anything on the actual GST portal.',
        checklist: [
          'Pick the right company and period before reading or uploading anything — GST return numbering and periods are per-entity.',
          'Upload the period’s real GSTR-2B download rather than defaulting to manual entry for everything; use manual lines only for the exceptions the upload missed.',
          'Action every IMS line (accept or reject) instead of leaving it Pending, then check GSTR-3B’s net payable against the ITC reconciliation behind it before treating the number as final.',
        ],
        watchOut: 'GSTR-2B is evidence to reconcile against, not a replacement purchase register — SB Ops’ own Vendor Bills stay the real accounting record even after a GSTR-2B line is matched and accepted.',
      }),
      feature('bank-rec', 'Bank Reconciliation', GitCompareIcon, ['Accounts → Bank Reconciliation lists every posting against the Bank & Cash account. Tick a line when it has cleared on the bank statement.', 'Import Statement: upload the bank’s CSV or Excel statement. Lines that match one ledger entry exactly (same amount, within a few days) are ticked for you after you confirm; unclear matches are listed for you to tick; a statement line with no entry (a bank charge, interest) can be posted on the spot by choosing its account.'], {
        outcome: 'The reconciled balance matches what has cleared on the bank statement, and the unreconciled list is a true exception queue.',
        checklist: [
          'Check the preview before confirming an import.',
          'Leave anything that has not cleared unticked.',
          'Chase a line that stays unreconciled; do not tick it to clear the list.',
        ],
        watchOut: 'The statement itself is not stored; importing again simply matches what is still unreconciled. Check the first import from each bank carefully, as column layouts differ.',
      }),
      feature('service-expenses', 'Service Expenses', ReceiptIcon, ['Accounts → Service Expenses shows cash requests and travel claims from the Service team that the manager and the executive have already approved.', 'Open one to check the amounts and receipts, then settle it: settled-on date, accounted by and checked.', 'A cash request shows how much of the advance has been used on travel claims and what remains.'], { outcome: 'Every approved request is settled, with the date and the person recorded.', watchOut: 'Settling does not post to the ledger. Record the payment as a journal entry as well.' }),
      feature('fixed-assets', 'Fixed Assets', BoxesIcon, ['Accounts → Fixed Assets: add an asset with its cost, salvage value, useful life and method (straight line or written down value). Adding it posts the purchase.', "Run depreciation for a month to post that month's depreciation for every active asset.", 'Dispose sells or writes off an asset and posts the gain or loss. A wrongly entered asset is corrected by disposing of it at 0.'], { outcome: 'The asset register, accumulated depreciation and the ledger agree.', watchOut: 'Depreciation is by whole months. A locked period refuses the posting.' }),
      feature('audit-log', 'Audit Log', LockIcon, ['Accounts → Audit Log lists who did what and when across the app: approvals, edits, deletions, settings changes.', 'Search by action, person or detail. The newest 200 entries show first.'], { outcome: 'You can answer who changed a record and when.', watchOut: 'The log cannot be edited or cleared.' }),
      feature('assistant', 'Help assistant and AI credit', MessageSquareIcon, ["Settings → Assistant (admin and the Accounts Head): the OpenRouter key, the writing model, and the AI credit left, used and bought. Add credit opens OpenRouter's credit page.", 'When credit runs out the assistant tells users to contact Accounts.', "Answers about live data (orders, stock, payments) stay off until the customer's approval is recorded there by admin."], { outcome: 'The assistant has credit and the right model.', watchOut: 'The key is shown only once, when pasted. Keep a copy somewhere safe.' }),
      feature('reports', 'Accounts reports', BarChart3Icon, ['Reports → Accounts: Trial Balance, Profit & Loss, Balance Sheet, Cash Flow Statement, Customer Ledger, Vendor Ledger, Receivables Aging, Payables Aging, Cash / Bank Book, Journal Register, Bank Reconciliation Statement, GSTR-1, GSTR-3B, ITC Reconciliation, TDS Deduction Register, Fixed Asset Register and Depreciation Schedule.', 'Pick the company in the top bar and the dates on the report. Each one downloads as PDF, Excel or CSV.'], { outcome: 'The figures handed to the auditor or CA come straight from the ledger.', watchOut: 'A report that looks wrong is fixed in what was posted, never in the report.' }),
      feature('invoices-bills', 'Invoices, vendor bills and e-way bill set-up', ReceiptIcon, ['Sales raises and issues Sales Invoices; Procurement records and approves Vendor Bills. Both post to the ledger by themselves. Accounts marks an invoice Paid or records receipts and payments under General Ledger → AR / AP settlement.', 'Accounts can open any packing list from Reports → Dispatch Register to see its freight and e-way bill.', 'E-way bill set-up: Accounts → Company Entities holds the company’s e-way bill API credentials (from the government e-way bill portal: Registration → For API) and a Test Connection button, plus the company’s place and pincode. New Company adds another company where the plan allows it.'], { outcome: 'Billing documents reach the books without retyping.', watchOut: 'E-way bill credentials are stored encrypted and never shown again; re-enter them to change them.' }),
    ],
    howTo: [
      { title: 'Confirm the company and period first', body: 'Pick the company in the top bar and the period before doing anything else — invoice numbering, GST return periods, and every report are scoped to that pair, and picking the wrong one is the easiest way to post or read the wrong company’s books.' },
      { title: 'Let documents post themselves; use Manual Journal Entry only for the rest', body: 'Issuing a Sales Invoice, approving a Vendor Bill, raising a Credit/Debit Note, and marking a Salary Slip paid all post their own journal entry automatically. Reach for a Manual Journal Entry only for a real adjustment none of those cover.' },
      { title: 'Settle what has actually been paid', body: 'Record a customer receipt or vendor payment against the real invoice or bill so Accounts Receivable/Payable reflects real cash movement, not just document status.' },
      { title: 'Reconcile GST and the bank statement', body: 'Upload the period’s GSTR-2B and action every IMS line (accept/reject) instead of leaving it Pending; tick off Bank & Cash postings against the real bank statement.' },
      { title: 'Check the Trial Balance before calling a period closed', body: 'Trial Balance, P&L, and Balance Sheet are read-only rollups off the ledger — if debit and credit don’t match, or a balance looks wrong, the fix is in what posted upstream, never in the report itself.' },
    ],
  },
  HR: {
    title: 'Human Resources', icon: UsersIcon,
    intro: ['HR keeps the people record accurate from joining to leaving: employee details, onboarding, attendance, leave, payroll inputs, expenses, advances, and separation.', 'HR data is sensitive. Check the employee and date before saving changes, and use the workflow status instead of deleting history.'],
    features: [
      feature('employees', 'Employees', UserRoundIcon, ['HR → Employees lists staff and workers. New Employee adds one: name, code, department, designation, type (Staff or Worker), contact and joining date. Open an employee to edit details or see history.', 'Every app login belongs to an HR employee, so add the employee here before a manager gives them access. Use separation rather than deleting a past employee.']),
      feature('onboarding', 'Onboarding and separation', UserCheckIcon, ['Open the employee in HR → Employees. Onboarding lists the joining tasks (documents, induction, equipment, approvals); tick each as it is done.', 'Start Separation opens the exit: exit details, tasks, leave encashed and the settlement, with View Settlement PDF. Finish it before switching the employee off.']),
      feature('attendance', 'Attendance and shifts', Clock3Icon, ['HR → Attendance shows each day’s record per employee (present, half-day, absent, late, early exit); shop-floor workers are marked by Production on their daily sheet and appear here.', 'HR → Shifts holds Shift Types and Shift assignments. Check the date and assigned shift before correcting an entry.']),
      feature('leave', 'Leave and holidays', CalendarDaysIcon, ['HR → Leave: New Leave Request for an employee (leave type, dates, half-day, reason). The person they report to, or the HR Head, is notified and approves or rejects under Leave Requests; the employee is told the decision.', 'HR → Holidays is the Holiday Calendar. A rejected or cancelled request stays on record.']),
      feature('payroll', 'Payroll', IndianRupeeIcon, ['HR → Payroll has Payroll Runs, Salary Slips, Additional Salary, Structures and Statutory Settings (PF, ESI, professional tax and income tax slabs).', 'Assign a salary structure to each employee, add one-off amounts under Additional Salary, create the run for the month, review it, then generate the slips. Marking a slip Paid posts it to the books; the slip PDF is the payslip.']),
      feature('expenses', 'Expenses and advances', ReceiptIcon, ['HR → Expenses holds employee expense claims and advances. A new claim notifies the HR Head, who approves, rejects or marks it paid; the employee is told.', 'Service team travel claims and cash requests are separate: they are under the Service team’s Expenses screen and Approvals → Service Expenses.']),
      feature('recruitment', 'Recruitment', UserPlusIcon, ['HR → Recruitment: create a job opening, add applicants to it, and move each applicant through the stages to offered and hired.', 'Hiring an applicant creates the employee record, so details are not typed twice.'], { outcome: 'Every opening shows its applicants and where each one stands.', watchOut: 'Close an opening once it is filled so it stops showing as open.' }),
    ],
    howTo: [
      { title: 'Onboard someone', body: 'Open HR → Employees → New Employee, set department and designation, then open the employee and work through Onboarding. Ask a manager to give them a login from Settings if they need one.' },
      { title: 'Correct attendance', body: 'Open HR → Attendance, choose the employee and exact date, check the shift, and correct the record.' },
      { title: 'Process leave', body: 'Open HR → Leave → Leave Requests, check the dates, balance and holidays, then approve or reject.' },
      { title: 'Run payroll', body: 'Open HR → Payroll. Check Structures and Additional Salary, create the run under Payroll Runs, review the totals, then generate Salary Slips.' },
      { title: 'Hire from an opening', body: 'Open HR → Recruitment, create the opening, add applicants and move them through the stages; hiring one creates the employee.' },
      { title: 'Complete separation', body: 'Open the employee, Start Separation, finish the tasks and the settlement, then switch the employee off.' },
    ],
  },
};

enrichHowTo();

// Keep the department list in one place for the Help renderer and simple future additions.
export const DEPARTMENT_HELP_ORDER = ['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation', 'Sales', 'Marketing', 'HR', 'Accounts'];
