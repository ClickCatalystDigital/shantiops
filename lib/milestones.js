// lib/milestones.js
// Milestone taxonomy from WORK_FLOW_TRACHER_DASH_BOAD.xlsx. Every new unit gets these seeded in
// order. Each entry also carries a `department` (controlled enum, for exec grouping) and a
// `category` (drives which extra fields the edit drawer shows).

// Controlled department list — used as the drawer <select> options, Nav Departments menu, and the
// Settings access matrix. Engineering owns the BOM (no milestones of its own); Stores owns the
// BOM's GRN/receipt columns (also no milestones — same precedent). Sales (V2-CHANGES.md Group 6
// Phase 6.1) owns no milestones either — same precedent again, it works through Sale Orders, not
// the milestone tracker. Marketing (V3_CHANGES.md A1) is the same shape as Sales — no milestones,
// shares the opportunities pipeline (A4) with Sales. HR (V3_CHANGES.md §12) is the same shape
// again — no milestones, owns the native employees/attendance/leave/recruitment module instead.
// Accounts (ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 0) is the same shape again — no milestones,
// owns company_settings and (from later phases) the GST/TDS masters and invoicing documents.
export const DEPARTMENTS = ['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation', 'Sales', 'Marketing', 'HR', 'Accounts'];

// Why a milestone slipped — controlled, powers the exec "Delayed because" view + project delay hero.
export const DELAY_CATEGORIES = ['Vendor', 'Material', 'Design', 'Customer', 'Other'];

// category: design | procurement | production | qc | packing | site
// short: compact form for the tracker's column-header strip (full label everywhere else).
export const MILESTONE_TEMPLATE = [
  { key: 'design',            label: 'Design',                                   short: 'Design',       department: 'Design',       category: 'design' },
  { key: 'design_approval',   label: 'Submit Design Approval',                   short: 'Dsn Appr',     department: 'Design',       category: 'design' },
  { key: 'release_bom',       label: 'Release BOM / PR',                         short: 'BOM/PR',       department: 'Design',       category: 'design' },
  { key: 'release_drawings',  label: 'Release All Drawings',                     short: 'Drawings',     department: 'Design',       category: 'design' },
  // Replaced the old 5 per-material-category milestones (Order BQ/Tubes, Procure Tubes, Order MS,
  // Order Valves, Order Panel) — nothing in the app actually tags a BOM item by material category
  // (tube vs MS vs valve vs panel), so those 5 could only ever be marked by hand with no real
  // signal behind them. These 5 instead mirror the BOM item's own purchase_status lifecycle
  // (lib/bom-fields.mjs's ACTIVE_STAGES) — a real, already-tracked progression every item moves
  // through, auto-advanced by lib/milestone-auto.js's syncProcurementMilestones (2026-08-17).
  { key: 'procurement_enquiry',    label: 'Enquiry',    short: 'Enquiry',    department: 'Procurement', category: 'procurement' },
  { key: 'procurement_comparison', label: 'Comparison', short: 'Comparison', department: 'Procurement', category: 'procurement' },
  { key: 'procurement_ordered',    label: 'Ordered',    short: 'Ordered',    department: 'Procurement', category: 'procurement' },
  { key: 'procurement_transit',    label: 'Transit',    short: 'Transit',    department: 'Procurement', category: 'procurement' },
  { key: 'procurement_procured',   label: 'Procured',   short: 'Procured',   department: 'Procurement', category: 'procurement' },
  { key: 'marking_cutting',   label: 'Marking, Cutting, Rolling Shell',          short: 'Mark/Cut',     department: 'Production',   category: 'production' },
  { key: 'drilling',          label: 'Drilling',                                 short: 'Drilling',     department: 'Production',   category: 'production' },
  { key: 'shell_welding',     label: 'Shell Welding',                            short: 'Shell Weld',   department: 'Production',   category: 'production' },
  { key: 'site_marking',      label: 'Site Marking',                             short: 'Site Mark',    department: 'Production',   category: 'production' },
  { key: 'welding_fura',      label: 'Welding (FURA-B / RC / AR)',               short: 'Weld FURA',    department: 'Production',   category: 'production' },
  { key: 'box_up',            label: 'Box Up',                                   short: 'Box Up',       department: 'Production',   category: 'production' },
  { key: 'box_up_welding',    label: 'Box Up Welding (OS / IS / G)',             short: 'Box Weld',     department: 'Production',   category: 'production' },
  { key: 'tube_stay_welding', label: 'Tubes & Stay Rods — Insert & Welding',     short: 'Tube/Stay',    department: 'Production',   category: 'production' },
  { key: 'pad_plates',        label: 'Pad Plates / Saddles / Nozzles / LH',      short: 'Pad Plates',   department: 'Production',   category: 'production' },
  { key: 'smoke_box',         label: 'Smoke Box / Feed Line / Ladder / Platform',short: 'Smoke Box',    department: 'Production',   category: 'production' },
  // Shifted from QC to Production (Production runs/witnesses the test on the shop floor day to
  // day; category stays 'qc' — still a pass/fail gate, that classification is unchanged, only who
  // owns doing it moved). Existing projects' already-seeded rows are migrated in lib/db.js
  // (department is stored per-row at creation, not derived from this template on every read).
  { key: 'hydro_test',        label: 'Hydro Test (HT)',                          short: 'Hydro Test',   department: 'Production',   category: 'qc' },
  { key: 'refractory',        label: 'Refractory',                               short: 'Refractory',   department: 'Production',   category: 'production' },
  { key: 'painting',          label: 'Painting',                                 short: 'Painting',     department: 'Production',   category: 'production' },
  { key: 'packing',           label: 'Packing & Labeling',                       short: 'Packing',      department: 'Dispatch',     category: 'packing' },
  { key: 'site_installation', label: 'Site Installation',                        short: 'Site Install', department: 'Installation', category: 'site' },
  { key: 'commissioning',     label: 'Commissioning & Handover',                 short: 'Commission',   department: 'Installation', category: 'site' },
];

const BY_KEY = Object.fromEntries(MILESTONE_TEMPLATE.map(m => [m.key, m]));
export function categoryOf(key) { return BY_KEY[key]?.category || 'production'; }
export function departmentOf(key) { return BY_KEY[key]?.department || 'Production'; }

// The last milestone that must be reached before a packing list can be marked ready.
export const PACKING_MILESTONE_KEY = 'packing';

// Customer-facing phases — business language, NOT internal milestone names. Each phase's status is
// rolled up from its member milestones for the read-only portal stepper.
export const CUSTOMER_PHASES = [
  { key: 'order',        label: 'Order Received',       keys: [] }, // implicit — project exists
  { key: 'design',       label: 'Design & Engineering', keys: ['design', 'design_approval', 'release_bom', 'release_drawings'] },
  { key: 'procurement',  label: 'Material Procurement', keys: ['procurement_enquiry', 'procurement_comparison', 'procurement_ordered', 'procurement_transit', 'procurement_procured'] },
  { key: 'manufacturing',label: 'Manufacturing',        keys: ['marking_cutting', 'drilling', 'shell_welding', 'site_marking', 'welding_fura', 'box_up', 'box_up_welding', 'tube_stay_welding', 'pad_plates', 'smoke_box'] },
  { key: 'testing',      label: 'Quality Testing',      keys: ['hydro_test'] },
  { key: 'finishing',    label: 'Finishing',            keys: ['refractory', 'painting'] },
  { key: 'packing',      label: 'Packing',              keys: ['packing'] },
  { key: 'installation', label: 'Site Installation',    keys: ['site_installation'] },
  { key: 'commissioning',label: 'Commissioning',        keys: ['commissioning'] },
];
