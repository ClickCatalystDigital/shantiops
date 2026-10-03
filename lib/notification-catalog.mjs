// lib/notification-catalog.mjs — every alert type a person can choose to receive, grouped by
// department, for Settings → Alerts. Pure data (client + server). `heads: true` = only a Head of that
// department ever receives it (sent via notifyDepartmentHeads / a Head-gated action), so only Heads
// see it in their settings. A kind not listed here still reaches people; it falls under the
// "Everything else" row (OTHER_KIND). Add a row here when a new alert kind is introduced.
//   node lib/notification-catalog-selfcheck.mjs

export const OTHER_KIND = '__other__';

export const ALERT_GROUPS = [
  { key: 'General', label: 'Projects & hand-offs', alerts: [
    { kind: 'handoff', label: 'Hand-off to your department', hint: 'The previous department finished its part of a project.' },
    { kind: 'reopened', label: 'Milestone sent back', hint: 'A finished milestone was reopened for rework.' },
    { kind: 'assigned', label: 'Assigned to you', hint: 'Someone assigned you a task or milestone.' },
    { kind: 'request', label: 'Requests from other departments', hint: 'A task raised for your department.' },
    { kind: 'materials_complete', label: 'All material in', hint: 'Every line for a project has arrived.' },
    { kind: 'project_complete', label: 'Project complete', hint: 'Commissioning finished on a project.' },
  ] },
  { key: 'PM', label: 'Management', pm: true, alerts: [
    { kind: 'sale_order_created', label: 'New sale order', hint: 'Sales booked an order.' },
    { kind: 'sales_invoice_created', label: 'Invoice raised', hint: 'A sales invoice was created.' },
    { kind: 'project_created', label: 'New project', hint: 'A project was created from an order.' },
  ] },
  { key: 'Sales', label: 'Sales', alerts: [
    { kind: 'quotation_approval', label: 'Discount needs approval', hint: 'A quotation discount is above the limit.', heads: true },
    { kind: 'quotation_approved', label: 'Discount approved', hint: 'Your quotation discount was approved.' },
    { kind: 'quotation_followup', label: 'Quotation follow-up due', hint: 'A sent quotation is expiring or quiet.' },
    { kind: 'payment_followup', label: 'Payment follow-up due', hint: 'An order still has money pending.' },
    { kind: 'order_alert', label: 'Order delivery alerts', hint: 'An order is overdue or waiting too long.' },
    { kind: 'order_dispatched', label: 'Order dispatched', hint: 'Your order went out.' },
    { kind: 'diary_alert', label: 'Diary updates', hint: 'A colleague logged a call you were tagged on.' },
    { kind: 'diary_plan', label: 'Follow-ups planned for you', hint: 'A follow-up was put on your plan.' },
    { kind: 'trade_request', label: 'Trade requests', hint: 'Service asked Sales for an item.' },
    { kind: 'retention_due', label: 'Data clean-up due', hint: 'Old Diary entries can be archived.', heads: true },
  ] },
  { key: 'Design', label: 'Design', alerts: [
    { kind: 'drawing_submitted', label: 'Drawing submitted for review', hint: 'A designer sent a drawing to you.', heads: true },
    { kind: 'comment', label: 'Customer comments on drawings', hint: 'A customer replied on a shared drawing.', heads: true },
    { kind: 'drawing_status', label: 'Your drawing was reviewed', hint: 'Approved, sent back or reassigned.' },
    { kind: 'customer_drawing', label: 'Customer uploaded a drawing', hint: 'New file from the customer portal.' },
    { kind: 'approval', label: 'Design approvals', hint: 'A design approval changed.' },
  ] },
  { key: 'Engineering', label: 'Engineering', alerts: [
    { kind: 'bom_template_applied', label: 'Template applied to a BOM', hint: 'A structure template was used on a project.' },
  ] },
  { key: 'Procurement', label: 'Procurement', alerts: [
    { kind: 'po_void_needed', label: 'Purchase order needs voiding', hint: 'A line on an issued PO was cancelled.' },
  ] },
  { key: 'Stores', label: 'Stores', alerts: [
    { kind: 'bom_released', label: 'BOM released', hint: 'Design released a project BOM.' },
    { kind: 'bom_received', label: 'Material received', hint: 'A line was marked received.' },
    { kind: 'indent_raised', label: 'Production request raised', hint: 'Production asked for material.' },
    { kind: 'inward_approval_decided', label: 'QC decided an inward review', hint: 'Material approved or rejected.' },
    { kind: 'remnant_pending_receipt', label: 'Remnant returned', hint: 'A cut remnant is waiting to be confirmed.' },
    { kind: 'plan_alert', label: 'Material shortages ahead', hint: 'Lines not covered for production starting soon.' },
  ] },
  { key: 'Production', label: 'Production', alerts: [
    { kind: 'indent_ready', label: 'Material ready to request', hint: 'Routed material is waiting for an indent.' },
    { kind: 'indent_released', label: 'Material released to you', hint: 'Stores issued your request.' },
    { kind: 'jobsheet_sent_back', label: 'Job card stage sent back', hint: 'QC returned a stage.' },
    { kind: 'qc_hold_released', label: 'QC hold released', hint: 'A held job can continue.' },
    { kind: 'ncr_dispositioned', label: 'NCR decided', hint: 'QC decided how to handle a non-conformance.' },
  ] },
  { key: 'QC', label: 'QC', alerts: [
    { kind: 'inward_approval_pending', label: 'Inward review waiting', hint: 'Received material needs QC approval.', heads: true },
    { kind: 'qc_incoming', label: 'Material arriving', hint: 'Incoming inspection can start.' },
    { kind: 'jobsheet_qc', label: 'Job card stage ready to sign', hint: 'Production finished a stage.' },
    { kind: 'qc_hold', label: 'Job held for QC', hint: 'A job card is waiting on a QC release.' },
    { kind: 'qc_fail', label: 'Test failed', hint: 'A QC test failed.' },
    { kind: 'ncr_raised', label: 'NCR raised', hint: 'A non-conformance was reported.' },
    { kind: 'procurement_procured', label: 'All items procured', hint: 'A project is fully bought.' },
  ] },
  { key: 'Dispatch', label: 'Dispatch', alerts: [
    { kind: 'packing_ready', label: 'Items ready to pack', hint: 'Production marked items done.' },
    { kind: 'jobsheet_dispatch', label: 'Job card at Dispatch', hint: 'A job reached its Dispatch stage.' },
    { kind: 'predispatch_decided', label: 'Pre-dispatch decision', hint: 'QC or Production signed off a list.' },
  ] },
  { key: 'Accounts', label: 'Accounts', alerts: [
    { kind: 'service_expense', label: 'Service expenses', hint: 'A cash or travel claim moved to you.' },
  ] },
];

export const EMAIL_MODES = ['off', 'instant', 'daily'];

// Groups a person sees: General always; Management for PMs; each department they hold. Head-only
// alerts only for Heads of that department. isHeadOf(dept) and isPm are computed by the caller.
export function visibleGroups({ departments = [], isPm = false, isHeadOf = () => false }) {
  return ALERT_GROUPS
    .filter(g => g.key === 'General' || (g.pm ? isPm : (isPm || departments.includes(g.key))))
    .map(g => ({ ...g, alerts: g.alerts.filter(a => !a.heads || isPm || isHeadOf(g.key)) }))
    .filter(g => g.alerts.length);
}

const KNOWN = new Set(ALERT_GROUPS.flatMap(g => g.alerts.map(a => a.kind)));
// The preference row that governs a kind: its own, else the "Everything else" row.
export const prefKey = kind => (KNOWN.has(kind) ? kind : OTHER_KIND);

// Defaults (decided 2026-10-03): in-app on, email off until the person turns it on.
export function resolvePref(row) {
  return { in_app: row ? !!row.in_app : true, email: row && EMAIL_MODES.includes(row.email) ? row.email : 'off' };
}
