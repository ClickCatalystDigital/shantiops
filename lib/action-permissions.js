// lib/action-permissions.js — the admin-configurable action catalog behind Settings' Action
// Permissions card. Each entry is one gated action; whether it's actually Head-only or open to
// everyone is stored in the action_permissions table (lib/db.js), not here — this file is just the
// list of what exists and its display label, department by department, added incrementally as
// routes get wired to canPerformAction() below (see that route's own comment for "why this key").
// Procurement is the first (and so far only) fully-wired department — a template for the rest.
import { NextResponse } from 'next/server';
import { queryOne } from './db';
import { isPM, isDepartmentHead, canAccessDepartment } from './auth';

// Design/Engineering note: Design's own approve/delete actions (calc-formula approval, drawing
// deletion, calc/drawing approval) are deliberately NOT in this catalog. They're gated by
// hasActiveDesignResponsibility (lib/auth.js), a pre-existing mechanism that predates this table
// and is hardcoded Head-only, not admin-configurable — a real, intentional boundary (see
// GAPS-AND-NEXT-STEPS.md-style reasoning: migrating a stable hardcoded rule into a toggle that
// could be flipped open is a bigger, riskier change than this pass was asked to make), not an
// oversight. Engineering's own actions below (BOM add/delete/import) are separate real actions
// that never had Design's hardcoded gate and are genuinely new to the configurable system.
export const ACTION_CATALOG = {
  Engineering: [
    { key: 'engineering.bom.add_item', label: 'Add a BOM item' },
    { key: 'engineering.bom.delete_item', label: 'Delete a BOM item' },
    { key: 'engineering.bom.import', label: 'Import or replace a BOM (PMB workbook)' },
    { key: 'engineering.assembly.add', label: 'Create or edit a BOM assembly' },
    { key: 'engineering.assembly.delete', label: 'Delete a BOM assembly' },
    { key: 'engineering.ecn.raise', label: 'Raise an Engineering Change Note' },
    { key: 'engineering.ecn.approve', label: 'Approve or reject an Engineering Change Note' },
  ],
  Procurement: [
    { key: 'procurement.return.write', label: 'Raise or update a purchase return' },
    { key: 'procurement.supplier.write', label: 'Add or edit a supplier' },
    { key: 'procurement.supplier.deactivate', label: 'Deactivate a supplier' },
    { key: 'procurement.rfq.create', label: 'Create an RFQ' },
    { key: 'procurement.rfq.record', label: 'Record or resend an RFQ' },
    { key: 'procurement.quotes.record', label: 'Record a supplier quote' },
    { key: 'procurement.quote.select', label: 'Select or unselect a supplier quote' },
    { key: 'procurement.po.create', label: 'Create a draft PO' },
    { key: 'procurement.po.edit_lines', label: 'Edit PO lines' },
    { key: 'procurement.po.issue', label: 'Issue a PO' },
    { key: 'procurement.po.unissue', label: 'Unissue a PO' },
    { key: 'procurement.po.cancel', label: 'Cancel (void) a PO' },
    { key: 'procurement.status.manual_edit', label: 'Manually change a BOM item’s purchase status' },
    { key: 'procurement.request.decide', label: 'Accept or reject a new-item procurement request' },
    { key: 'procurement.vendor_bill.write', label: 'Record a Vendor Bill against a PO' },
    { key: 'procurement.vendor_bill.status', label: 'Update a Vendor Bill’s status or payment reference' },
    { key: 'procurement.debit_note.write', label: 'Raise a debit note against a Vendor Bill' },
    { key: 'procurement.vendor_bill.payment.write', label: 'Record a payment against a Vendor Bill' },
  ],
  Stores: [
    { key: 'stores.inventory.write', label: 'Add or edit an inventory item' },
    { key: 'stores.procure', label: 'Send a Stores-Review line to Procurement (Procure)' },
    { key: 'stores.allocation_mode.write', label: 'Switch the Allocation Mode (Auto/Manual)' },
    { key: 'stores.reservation.reserve', label: 'Reserve stock against a requirement' },
    { key: 'stores.reservation.issue', label: 'Issue a reservation (hand out material)' },
    { key: 'stores.reservation.release', label: 'Release a reservation' },
    { key: 'stores.gir.write', label: 'Log or close a Gate Inward Receipt' },
    { key: 'stores.gatepass.write', label: 'Create, issue, or mark a Gate Pass returned' },
    { key: 'stores.gatepass.approve', label: 'Approve a Gate Pass' },
  ],
  QC: [
    { key: 'qc.test.write', label: 'Create or edit a test record' },
    { key: 'qc.test.delete', label: 'Delete a test record' },
    { key: 'qc.document.write', label: 'Create or edit a statutory document' },
    { key: 'qc.document.delete', label: 'Delete a statutory document or part row' },
    { key: 'qc.certificate.write', label: 'Add or edit a Test Certificate' },
    { key: 'qc.certificate.delete', label: 'Delete a Test Certificate' },
    { key: 'qc.jobwork.write', label: 'Create or update a job-work inspection' },
    { key: 'qc.jobwork.delete', label: 'Delete a job-work inspection' },
    { key: 'qc.calibration.write', label: 'Create or update a calibration item' },
    { key: 'qc.calibration.delete', label: 'Delete a calibration item' },
  ],
  Dispatch: [
    { key: 'dispatch.packing.create', label: 'Create a packing list directly (not from BOM)' },
    { key: 'dispatch.packing.generate', label: 'Generate a packing list from the BOM' },
    { key: 'dispatch.packing.edit', label: 'Edit packing items or header details' },
    { key: 'dispatch.packing.status', label: 'Move a packing list’s status (Draft → Packed → Dispatched)' },
    { key: 'dispatch.packing.freight', label: 'Post freight expense to the ledger' },
  ],
  Installation: [
    { key: 'installation.milestone.complete', label: 'Mark Site Installation or Commissioning complete' },
    { key: 'installation.service_call.write', label: 'Create or update a service call (incl. visits)' },
    { key: 'installation.contract.write', label: 'Create or update a service contract' },
  ],
  Production: [
    { key: 'production.jobcard.create', label: 'Create a job card or rework card' },
    { key: 'production.jobcard.edit', label: 'Edit job card fields (status, quantity, workstation…)' },
    { key: 'production.jobcard.time_log', label: 'Log a time session' },
    { key: 'production.jobcard.consumable', label: 'Add a consumable' },
    { key: 'production.worker.write', label: 'Add or edit a worker' },
    { key: 'production.worker.deactivate', label: 'Activate or deactivate a worker' },
    { key: 'production.attendance.mark', label: 'Mark or correct the Daily Sheet' },
    { key: 'production.settings.write', label: 'Create an operation, trade, or workstation' },
    { key: 'production.bom.cut', label: 'Cut a plate/section stock piece' },
    { key: 'production.workorder.create', label: 'Create a Work Order' },
    { key: 'production.workorder.edit', label: 'Edit a draft Work Order' },
    { key: 'production.workorder.release', label: 'Release, complete, or cancel a Work Order' },
    { key: 'production.workorder.change_note', label: 'Change a released Work Order (Change Note)' },
  ],
  // Sales and Marketing share several routes. customers/quotations/sale-orders are gated per-user
  // (requireCrmAction picks whichever of the two the acting user actually has, Sales first — real
  // ownership per components/SalesWorkspace.jsx's own department-help wording). Leads, Opportunities,
  // and CRM Tasks are different: each row already carries its own owner_dept/department, resolved
  // server-side at creation and read back on every edit (app/api/opportunities/[id]/route.js,
  // app/api/crm-tasks/[id]/route.js) — so the crm.* keys below are gated by the RECORD's department,
  // not the acting user's, and are listed identically under both Sales and Marketing since either
  // can own one. CRM Notes (crm-notes) are deliberately excluded — they're an append-only activity
  // log with no owner_dept of their own and no per-record department check even today (any CRM-access
  // user can note any record); gating them would be inventing a rule that doesn't exist yet, not
  // wiring up a real one.
  Sales: [
    { key: 'sales.customer.write', label: 'Add a customer, contact, or address' },
    { key: 'sales.quotation.create', label: 'Create a quotation' },
    { key: 'sales.quotation.status', label: 'Update a quotation’s status' },
    { key: 'sales.quotation.convert', label: 'Convert a quotation to a Sale Order' },
    { key: 'sales.saleorder.create', label: 'Create a Sale Order' },
    { key: 'sales.saleorder.status', label: 'Edit or update a Sale Order' },
    { key: 'sales.price_list.write', label: 'Add, edit, or remove a price list entry' },
    { key: 'sales.return.write', label: 'Raise or update a sales return' },
    { key: 'sales.invoice.create', label: 'Convert a quotation to a Sales Invoice' },
    { key: 'sales.invoice.status', label: 'Update a Sales Invoice’s status or payment reference' },
    { key: 'sales.credit_note.write', label: 'Raise a credit note against a Sales Invoice' },
    { key: 'sales.invoice.receipt.write', label: 'Record a receipt against a Sales Invoice' },
    { key: 'crm.lead.create', label: 'Create a lead' },
    { key: 'crm.lead.convert', label: 'Convert a lead' },
    { key: 'crm.opportunity.create', label: 'Create an opportunity' },
    { key: 'crm.opportunity.write', label: 'Edit an opportunity or its line items' },
    { key: 'crm.task.create', label: 'Create a CRM task' },
    { key: 'crm.task.write', label: 'Edit or complete a CRM task' },
  ],
  Marketing: [
    { key: 'marketing.campaign.write', label: 'Create a campaign' },
    { key: 'crm.lead.create', label: 'Create a lead' },
    { key: 'crm.lead.convert', label: 'Convert a lead' },
    { key: 'crm.opportunity.create', label: 'Create an opportunity' },
    { key: 'crm.opportunity.write', label: 'Edit an opportunity or its line items' },
    { key: 'crm.task.create', label: 'Create a CRM task' },
    { key: 'crm.task.write', label: 'Edit or complete a CRM task' },
  ],
  // Employees have no self-service portal in this app — HR data-enters requests on an employee's
  // behalf (leave, expense claims), which is why "submit" actions live in HR's own catalog rather
  // than looking like an approval step.
  HR: [
    { key: 'hr.employee.write', label: 'Add or edit an employee record' },
    { key: 'hr.onboarding.task', label: 'Add or complete an onboarding task' },
    { key: 'hr.separation.write', label: 'Start a separation, or add/complete its tasks' },
    { key: 'hr.separation.settle', label: 'Run a separation settlement' },
    { key: 'hr.attendance.mark', label: 'Mark or correct attendance' },
    { key: 'hr.leave.request', label: 'Log a leave request' },
    { key: 'hr.leave.decide', label: 'Approve or reject a leave request' },
    { key: 'hr.leave.allocate', label: 'Allocate a leave balance' },
    { key: 'hr.settings.write', label: 'Create a shift type, holiday, designation, or expense claim type' },
    { key: 'hr.shift_assignment.write', label: 'Assign an employee to a shift' },
    { key: 'hr.recruitment.write', label: 'Create or update a job opening, offer, applicant, or interview' },
    { key: 'hr.offer.decide', label: 'Update a job offer’s status' },
    { key: 'hr.applicant.decide', label: 'Update an applicant’s status' },
    { key: 'hr.payroll.run', label: 'Run or generate a payroll/salary slip' },
    { key: 'hr.payroll.slip_status', label: 'Update a salary slip’s status' },
    { key: 'hr.salary_structure.write', label: 'Create or edit a salary structure or assignment' },
    { key: 'hr.additional_salary.write', label: 'Add an additional salary line' },
    { key: 'hr.statutory.write', label: 'Update statutory rates or tax slabs' },
    { key: 'hr.expense.submit', label: 'Submit an expense claim' },
    { key: 'hr.expense.decide', label: 'Approve or reject an expense claim' },
    { key: 'hr.loan.write', label: 'Create an employee loan' },
    { key: 'hr.advance.write', label: 'Create an employee advance' },
    { key: 'hr.advance.decide', label: 'Approve or reject an employee advance' },
  ],
  Accounts: [
    { key: 'accounts.company_settings.write', label: 'Update a company’s GSTIN, PAN, or registered address' },
    { key: 'accounts.gst_rate.write', label: 'Add a GST rate' },
    { key: 'accounts.tds_rate.write', label: 'Add a vendor TDS rate' },
    { key: 'accounts.chart_of_accounts.write', label: 'Add or edit a chart of accounts entry' },
    { key: 'accounts.gst_filing.write', label: 'Mark a GST return period as filed' },
    { key: 'accounts.gstr2b.upload', label: 'Upload a GSTR-2B statement' },
    { key: 'accounts.gstr2b.write', label: 'Add, edit, or action (accept/reject) a GSTR-2B line' },
    { key: 'accounts.journal_entry.write', label: 'Create, edit, or delete a draft Manual Journal Entry' },
    { key: 'accounts.journal_entry.post', label: 'Post or reverse a Manual Journal Entry' },
    { key: 'accounts.bank_reconciliation.write', label: 'Mark a Bank & Cash ledger line reconciled' },
    { key: 'accounts.period_lock.write', label: 'Lock or move the books-closed date' },
    { key: 'accounts.fixed_asset.write', label: 'Add a fixed asset or run depreciation' },
  ],
};

// PM always passes (same bypass every department-access check in lib/auth.js already gives PMs).
// Otherwise: needs real department access, and if the action's configured requires_head=1, needs
// isDepartmentHead too. An action with no action_permissions row defaults to open (requires_head=0)
// — matches how every one of these routes behaved before this table existed, so wiring a new
// action in without configuring it yet is a no-op, not a silent lockout.
export async function canPerformAction(user, department, actionKey) {
  if (isPM(user)) return true;
  if (!canAccessDepartment(user, department)) return false;
  const row = await queryOne(
    'SELECT requires_head FROM action_permissions WHERE department = ? AND action_key = ?',
    [department, actionKey]
  );
  if (!row?.requires_head) return true;
  return isDepartmentHead(user, department);
}

// Route-ergonomic wrapper, same null-or-403 shape as lib/auth.js's requireDepartment.
export async function requireAction(user, department, actionKey) {
  if (await canPerformAction(user, department, actionKey)) return null;
  return NextResponse.json({ error: 'Forbidden — this action requires the department Head' }, { status: 403 });
}

// For a route gated by canAccessCrm (Sales OR Marketing OR PM) rather than one department: gate
// against whichever of the two the user actually has, Sales first (matches real ownership — see
// ACTION_CATALOG's Sales/Marketing comment). A user with neither falls through to Marketing and
// canPerformAction's own canAccessDepartment check denies them there, same end result as today.
export async function requireCrmAction(user, actionKey) {
  const dept = canAccessDepartment(user, 'Sales') ? 'Sales' : 'Marketing';
  return requireAction(user, dept, actionKey);
}
