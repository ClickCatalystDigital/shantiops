// Role-aware content for /help — plain data, no CMS. Adding a feature later = append one step
// object to the relevant section. Sections render via GuideSection/Step in app/help/page.js.
import {
  FolderKanbanIcon, GanttChartIcon, ClipboardListIcon, PackageIcon, ShieldCheckIcon,
  UserPlusIcon, SlidersHorizontalIcon, WrenchIcon, TruckIcon, FlaskConicalIcon, PenToolIcon,
  MapPinIcon, CircleGaugeIcon, KeyRoundIcon,
} from 'lucide-react';

export const PM_GUIDE = [
  {
    title: 'Projects & the milestone chain',
    icon: FolderKanbanIcon,
    steps: [
      { title: 'Create a project', body: 'Projects → New Project. The full 25-stage milestone chain seeds automatically with planned dates — nothing to set up by hand.' },
      { title: 'Adjust the schedule', body: 'Open a milestone card to edit planned/actual dates, assignee, or department. Use Bulk edit for a spreadsheet-style grid across all stages at once.' },
    ],
  },
  {
    title: 'Reading the Milestone Tracker',
    icon: GanttChartIcon,
    steps: [
      { title: 'The color bar', body: 'Gray = not started, blue = on track, amber = running late, red = blocked, green = closed. The vertical line marks today.' },
      { title: 'Expand for detail', body: 'Click a project row to expand its stage-by-stage pill chain with delay deltas and actual dates.' },
    ],
  },
  {
    title: 'Master BOM',
    icon: ClipboardListIcon,
    steps: [
      { title: 'Engineering imports the PMB', body: 'Project page → Engineering tab → Import PMB (.xlsx). Preview shows what was detected and skipped before anything is saved.' },
      { title: 'Who edits what', body: 'Engineering owns descriptions/specs; Procurement owns status/PR/PO; Stores owns GRN/receipt; Production owns issued/received. Each department only sees its own columns as editable — enforced by the server, not just hidden in the UI.' },
      { title: 'Track progress', body: 'The BOM rollup bar (per project and on Executive) shows % of items closed, section by section.' },
    ],
  },
  {
    title: 'Packing & Dispatch',
    icon: PackageIcon,
    steps: [
      { title: 'Generate from BOM', body: 'Dispatch tab → generate a draft packing list from whatever BOM lines are still pending. Partial dispatches are fine — leftover lines stay pending for the next list.' },
      { title: 'PDF output', body: 'Once a list is Ready, "Generate PDF" produces the customer-facing packing list; a separate Pending-list PDF exports unshipped lines only.' },
    ],
  },
  {
    title: 'Approvals',
    icon: ShieldCheckIcon,
    steps: [
      { title: 'Devices', body: 'USB/CD/phone requests need your TOTP code to approve — set it up once in Settings.' },
      { title: 'Browser', body: 'Set per-domain policy (allow / block / needs approval) for the company browser extension.' },
      { title: 'People', body: 'New employee/manager sign-ups land here as pending — approve or reject, and register their work machine in the same place.' },
    ],
  },
  {
    title: 'Onboarding a new employee, start to finish',
    icon: UserPlusIcon,
    steps: [
      { title: '1. They register', body: 'On the login page, "Request access" — they pick Department Head or Project Manager and fill in their details.' },
      { title: '2. You approve', body: 'Approvals → People → Pending Registrations. Adjust their departments if needed, then Approve (or Reject).' },
      { title: '3. Register their machine', body: 'Same tab, Onboarding Roster → Register machine — that\'s it on your end.' },
      { title: '4. They set it up themselves', body: 'When they next log in from their PC, they\'re shown their Enroll file and Installer downloads directly — no files for you to send. Their status dot goes green once the agent phones home.' },
    ],
  },
  {
    title: 'Approving with your OTP code',
    icon: KeyRoundIcon,
    steps: [
      { title: '1. One-time setup', body: 'Settings → USB Approval Authenticator — scan the QR code with any authenticator app. Required before you can approve anything.' },
      { title: '2. When a request comes in', body: 'Approvals → Devices (or Browser) → enter your current 6-digit code next to the request → Approve.' },
      { title: '3. The window it opens', body: 'Approval unlocks the device/site for a time-boxed window (default 15 min), then it re-locks automatically.' },
      { title: 'Wrong code too many times', body: '5 failed attempts locks your code entry for 15 minutes — not the whole account, just approvals.' },
    ],
  },
  {
    title: 'Settings',
    icon: SlidersHorizontalIcon,
    steps: [
      { title: 'Access Matrix', body: 'Grant or revoke departments for any head — a head with no departments sees an empty state until you assign one.' },
      { title: 'TOTP setup', body: 'Required once before you can approve any device request.' },
    ],
  },
];

// One entry per department a head might be granted — rendered as one section per granted dept.
export const HEAD_GUIDES = {
  Engineering: {
    title: 'Engineering — Bill of Materials',
    icon: PenToolIcon,
    steps: [
      { title: 'Import the PMB workbook', body: 'Upload the project\'s .xlsx → review the preview (items found, columns mapped, rows skipped) → Confirm. Nothing saves until you confirm.' },
      { title: 'Maintain items', body: 'Edit description, material spec, size, make, or quantity any time. Replacing the whole BOM is a separate, explicit action if the file changes.' },
    ],
  },
  Procurement: {
    title: 'Procurement — purchase status',
    icon: WrenchIcon,
    steps: [
      { title: 'Update status', body: 'Flip each BOM line between Pending, Transit, Closed, or Received as it moves through purchasing.' },
      { title: 'Track references', body: 'Fill in the PR and PO numbers/dates as they\'re issued — visible to everyone downstream.' },
    ],
  },
  Stores: {
    title: 'Stores — receipt & quantities',
    icon: PackageIcon,
    steps: [
      { title: 'Record receipt', body: 'GRN number/date, quantity received, and pending quantity as material arrives.' },
      { title: 'BQ-TC', body: 'Log the test-certificate receipt reference where required.' },
    ],
  },
  Production: {
    title: 'Production — milestones & material use',
    icon: CircleGaugeIcon,
    steps: [
      { title: 'Start / Close your stages', body: 'Each milestone card has Start and Close — closing late prompts for a delay reason.' },
      { title: 'Issued / Received', body: 'On the BOM, record what material was issued to the floor and received into work.' },
    ],
  },
  QC: {
    title: 'QC — inspection milestones',
    icon: FlaskConicalIcon,
    steps: [{ title: 'Start / Close your stages', body: 'Hydro Test and other QC milestones follow the same Start/Close flow as any department.' }],
  },
  Design: {
    title: 'Design — engineering milestones',
    icon: PenToolIcon,
    steps: [{ title: 'Start / Close your stages', body: 'Design, drawing release, and BOM release milestones — Start/Close as work happens.' }],
  },
  Dispatch: {
    title: 'Dispatch — packing board',
    icon: TruckIcon,
    steps: [
      { title: 'Pending → Ready → Dispatched', body: 'Generate a draft from the BOM, fill in box/qty/make details, then move it through the board.' },
      { title: 'PDF', body: 'Generate the final packing list once Ready, or export a pending-items list any time.' },
    ],
  },
  Installation: {
    title: 'Service — site milestones',
    icon: MapPinIcon,
    steps: [{ title: 'Start / Close your stages', body: 'Site Installation and Commissioning follow the same Start/Close flow.' }],
  },
};

export const CUSTOMER_GUIDE = [
  {
    title: 'Your order',
    icon: GanttChartIcon,
    steps: [
      { title: 'The phase stepper', body: 'Shows where your order is — Design, Procurement, Manufacturing, Testing, Finishing, Packing, Installation, Commissioning.' },
      { title: 'Progress & dispatch date', body: 'The percentage and estimated dispatch date update automatically as work completes.' },
      { title: 'Packing list', body: 'Once your order is packed, a "View / download packing list" link appears under Documents.' },
    ],
  },
];
