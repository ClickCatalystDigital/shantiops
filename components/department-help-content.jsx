// Department help content for /help. This is intentionally plain data: the renderer owns layout,
// while each department owns its vocabulary, feature order, and practical how-to guidance.
import {
  BookOpenIcon, ClipboardListIcon, CalculatorIcon, FolderKanbanIcon, FileInputIcon,
  RulerIcon, DraftingCompassIcon, SearchIcon, GitCompareIcon, FileTextIcon, TruckIcon,
  WarehouseIcon, PackageCheckIcon, BoxesIcon, UsersIcon, CalendarDaysIcon, HardHatIcon,
  FlaskConicalIcon, BadgeCheckIcon, ClipboardCheckIcon, MapPinIcon, RouteIcon, ShoppingCartIcon,
  UserPlusIcon, Building2Icon, MegaphoneIcon, TrendingUpIcon, PhoneIcon, BarChart3Icon,
  UserRoundIcon, UserCheckIcon, Clock3Icon, IndianRupeeIcon, ReceiptIcon, ShieldCheckIcon,
  ListChecksIcon, MessageSquareIcon, WrenchIcon,
} from 'lucide-react';

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
    value: 'The drawing record connects the file on someone’s computer to the project revision that other departments use. It prevents Production from building from an old or unidentified file.',
    outcome: 'The current drawing number, revision, status, and file agree, and the next team can tell which drawing is approved for use.',
    checklist: ['Use the project’s drawing number and revision convention.', 'Update status when the file moves through review, approval, or as-built stages.', 'Add a task when another person must review or correct the drawing.'],
    watchOut: 'Uploading a newer file without changing the revision creates a false sense of control. The revision label and the stored record must match.',
  },
  bom: {
    value: 'The BOM is the material contract between technical design and execution. It tells Procurement what to source and gives Stores, Production, QC, and Dispatch a common item identity.',
    outcome: 'Every required line has a usable description, specification, quantity, section, and ownership-aware downstream fields.',
    checklist: ['Preview imports before confirming them.', 'Check description, MOC, size/specification, make, quantity, section, and group.', 'Leave Procurement, Stores, and Production-owned operational fields to those teams.'],
    watchOut: 'Do not fix a technical mistake by creating a duplicate line. Correct the source definition and review the impact on quotes, receipts, and packing.',
  },
  tasks: {
    value: 'Tasks convert a vague follow-up into an owned action with a due date and history. They are the system’s memory for work that does not deserve a full milestone.',
    outcome: 'A person or department knows exactly what to do, by when, and what evidence closes the action.',
    checklist: ['Write the action as a verb, not only a topic.', 'Choose the correct department, person, project, and due date.', 'Close the task only after the action or response is actually complete.'],
    watchOut: 'Do not use a private note or chat message for a dependency that can delay another team. Raise a task so it remains visible.',
  },
  requests: {
    value: 'Requests give a new or changed material requirement a traceable path to Procurement. They prevent buyers from receiving incomplete instructions through informal messages.',
    outcome: 'Procurement can source the requested item without repeatedly asking for the project, quantity, specification, or reason.',
    checklist: ['Select the correct project or requirement context.', 'Include item description, quantity, size/specification, MOC, and reason.', 'Respond to clarification tasks in the same traceable flow.'],
    watchOut: 'Do not create a second request because the first one is missing information. Complete the original trail or correct the source BOM line.',
  },
  milestones: {
    value: 'Milestones show the major handoffs in an order’s lifecycle. They turn project progress into dates and ownership that Management and the customer can rely on.',
    outcome: 'The milestone has an honest status, actual dates, delay reason when needed, and a visible next action for the receiving team.',
    checklist: ['Start the milestone when work really begins.', 'Record the actual end date only when the deliverable is complete.', 'Use stages or tasks for remaining follow-up instead of hiding unfinished work.'],
    watchOut: 'Closing a milestone to remove it from an attention list makes the project look healthier while losing the real blocker.',
  },
  enquiry: {
    value: 'The Enquiry queue is Procurement’s controlled entry point for demand. It makes sure every item is understood before supplier conversations begin.',
    outcome: 'The requirement has a clear source, project context, usable specification, and an owner moving it toward comparison.',
    checklist: ['Confirm whether the item is project, In-Stock, or Sold-As-Such demand.', 'Check the technical definition before asking suppliers for prices.', 'Raise missing-information tasks back to the requesting department.'],
    watchOut: 'A cheap quote for the wrong specification is not progress. Resolve the technical identity before comparing prices.',
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
    value: 'A Purchase Order is the formal commitment to the supplier. It turns an internal requirement into clear quantities, rates, terms, and delivery expectations.',
    outcome: 'The issued PO matches the selected quote and BOM requirement, and Stores can later match the delivery to it.',
    checklist: ['Review supplier, lines, quantities, rates, terms, and delivery details.', 'Check the generated PDF before sending it.', 'Use unissue or void only for a controlled correction with a clear reason.'],
    watchOut: 'Issuing a PO with the wrong quantity or unit is more expensive than spending another minute on the draft.',
  },
  status: {
    value: 'Status gives every department a shared answer to “where is this item now?” The system also uses quote, supplier, and PO signals to expose stale stored statuses.',
    outcome: 'The visible stage reflects the real sourcing situation and contains enough references for the next team to act.',
    checklist: ['Read the item history, not just the status label.', 'Keep PR, quote, supplier, and PO references readable.', 'Move to Received only when Stores confirms the physical receipt.'],
    watchOut: 'Do not use a status change to hide missing paperwork or a delivery problem. Record the evidence that supports the stage.',
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
    value: 'Receipt fields record what physically arrived, not what was ordered. They let Stores and Production see the remaining balance and locate the supporting GRN or certificate.',
    outcome: 'GRN reference, date, received quantity, pending quantity, and certificate reference tell the same story.',
    checklist: ['Match the delivery to the PO and BOM line.', 'Enter actual received quantity and date.', 'Recheck the pending balance after partial receipts.'],
    watchOut: 'Do not enter the ordered total in a received field or leave a partial delivery looking complete.',
  },
  sas: {
    value: 'In-Stock and Sold-As-Such flows let the business source and use material that is not tied to a normal customer project without inventing a fake project history.',
    outcome: 'The material’s source, status, and eventual movement remain traceable even outside a standard project milestone chain.',
    checklist: ['Confirm whether the item is stock or Sold-As-Such demand.', 'Keep the source and status consistent through sourcing and issue.', 'Use the correct inventory movement when the item is consumed.'],
    watchOut: 'Do not attach stock demand to an unrelated customer project just to make a screen accept it.',
  },
  workers: {
    value: 'The Workers sheet captures shop-floor people who do not need application accounts. It gives Production a reliable daily view of attendance and where work happened.',
    outcome: 'Attendance and assignment data can support planning, payroll review, and project history without creating unnecessary logins.',
    checklist: ['Choose the exact date before marking attendance.', 'Record present, half-day, or absent accurately.', 'Add project and work assignment while the day is still known.'],
    watchOut: 'Do not delete a historical worker. Deactivate the person so earlier attendance remains understandable.',
  },
  handoff: {
    value: 'Handoffs prevent one department’s completion from becoming another department’s surprise. They connect the action, owner, and evidence across the order lifecycle.',
    outcome: 'The receiving department sees a clear task or notification with enough context to act without restarting the conversation.',
    checklist: ['Name the receiving department or person.', 'Include the project, item, date, and dependency.', 'Confirm the response before closing the handoff.'],
    watchOut: 'A notification is a signal, not proof of completion. Keep the actual result in the relevant record or task.',
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
    checklist: ['Complete company, customer, project, and equipment details.', 'Check every part row and reference.', 'Generate and inspect the PDF before treating it as final.'],
    watchOut: 'Do not advance an incomplete statutory record just because a PDF can be generated.',
  },
  board: {
    value: 'The packing board gives Dispatch one place to see what is still being prepared, what is ready, and what has already left the site.',
    outcome: 'Every list has one understandable status and an owner for the next physical or documentary action.',
    checklist: ['Start from the correct project and order.', 'Keep Draft, Ready, and Dispatched status truthful.', 'Check for an existing list before creating another one.'],
    watchOut: 'A Ready list is an approval to release, not a suggestion. Do not move it forward before the contents and header are checked.',
  },
  generate: {
    value: 'Generating from the BOM reduces manual re-entry and preserves the link between what Engineering defined and what Dispatch plans to pack.',
    outcome: 'Only intended pending lines are carried into a draft, with quantities that can be reconciled back to the BOM.',
    checklist: ['Review the project and pending-line selection.', 'Check partial quantities and previously packed lines.', 'Inspect the draft before adding package details.'],
    watchOut: 'Generating twice without reviewing existing lists can create duplicate packing work or confuse the remaining balance.',
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
    value: 'Leads capture early demand before it becomes a committed opportunity. Good lead data tells the team who asked, what they need, where they came from, and who should follow up.',
    outcome: 'The enquiry has an owner, source, next action, and enough context to qualify without duplicate records.',
    checklist: ['Capture person/company and contact details.', 'Set source, campaign, territory, and industry accurately.', 'Add a next task and update status after contact.'],
    watchOut: 'Do not create a second lead because another department also needs to work it. Sales and Marketing share the same funnel.',
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
    value: 'The Sale Order is the confirmed commercial handoff into execution. It gives Design and Engineering an agreed basis for the Scope of Supply and project creation.',
    outcome: 'Customer, address, order lines, commercial references, and project link all agree before technical work begins.',
    checklist: ['Confirm the accepted quotation and customer identity.', 'Check order lines, quantities, terms, and delivery expectations.', 'Link or create the project with useful commercial context.'],
    watchOut: 'Do not treat a draft or verbal acceptance as a confirmed Sale Order. The downstream team needs a reliable handoff.',
  },
  reports: {
    value: 'Reports turn the quality of CRM data into decisions about pipeline, sources, departments, and campaigns. They are useful only when the records beneath them are maintained.',
    outcome: 'The team can explain the numbers, the date range, and the source fields behind the result.',
    checklist: ['Choose the correct report and date/filter context.', 'Investigate missing source, campaign, or stage data.', 'Use the result to assign an action, not only to observe it.'],
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

function enrichHowTo() {
  for (const guide of Object.values(DEPARTMENT_HELP)) {
    guide.howTo = guide.howTo.map((step, index) => ({
      ...step,
      why: step.why || HOW_TO_NOTES[index]?.why(guide),
      verify: step.verify || HOW_TO_NOTES[index]?.verify,
    }));
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
      feature('scope', 'Scope of Supply', FileInputIcon, ['Read the work order created from a confirmed Sale Order. Confirm what the boiler, equipment, or package includes before detailed design starts.', 'Keep the scope clear and practical: what is included, what is excluded, and what the customer must provide. Release it only after Design and Engineering agree.']),
      feature('calc', 'Calculation Sheets', CalculatorIcon, ['Open Calc Sheets from the Design or Engineering tab and choose the project. Inputs, formulas, validations, snapshots, and review status stay attached to that project.', 'Save a snapshot when a calculation is ready for review. A snapshot is the frozen record of the exact inputs and formula versions used.']),
      feature('drawings', 'Drawings', RulerIcon, ['Use the Drawings panel to keep drawing files and their status with the calculation work. This is a release tracker, not a CAD editor.', 'Use clear drawing numbers and revision notes so Production can tell which file is current.']),
      feature('bom', 'Material definition and BOM', ClipboardListIcon, ['Define the material description, MOC, size/specification, make, quantity, section, and group label. Engineering/Design owns the technical definition; downstream teams add purchasing and receipt information.', 'Import the PMB workbook, review detected rows and skipped rows, then confirm. Never replace a live BOM without checking the revision preview.']),
      feature('tasks', 'Tasks and handoffs', ListChecksIcon, ['Use Tasks for small follow-ups that do not deserve a milestone. Raise a cross-department task when another team needs to act.', 'When a milestone closes, check the next team’s notification and task signal. Do not rely only on memory or a private note.']),
      feature('requests', 'Purchase requests', MessageSquareIcon, ['Use Requests when Design knows a material must be sourced but Procurement needs a formal request. Add the project, item, quantity, and useful specification.', 'The request goes directly to Procurement’s Enquiry flow; it is not a second approval queue.']),
    ],
    howTo: [
      { title: 'Start a new order', body: 'Open Projects, choose the order, read the Scope of Supply, and confirm the project assumptions before creating technical work.' },
      { title: 'Prepare technical work', body: 'Open Calc Sheets, enter the required inputs, run validations, save a snapshot, and upload or update the related drawing record.' },
      { title: 'Submit work for approval', body: 'Designers should move a completed calculation or drawing to Under review after checking the inputs, validations, revision, and files. Do not mark your own work Approved. The request is visible to the Design Head for review.' },
      { title: 'Review and approve Design work', body: 'The Design Head checks the project scope, calculation snapshot, validation result, drawing revision, and attached files. If the work is acceptable, the Design Head changes it to Approved or As built, assigns the next teammate, and sets a due date when needed. Executives, managers, and admins control who is a Design Head; they do not replace the Design Head’s technical review.' },
      { title: 'Handle corrections and access', body: 'If work needs correction, keep it in a working or Under review state and explain the required change in Notes or a Task before resubmission. A Design Head can grant or remove Designer access for active linked Design employees from Settings; executives, managers, and admins can assign Design Head responsibility.' },
      { title: 'Release the material definition', body: 'Import or review the BOM, correct descriptions/specifications, and confirm that quantity and section information is understandable to Procurement and Production.' },
      { title: 'Hand work to another team', body: 'Use a task for a specific action or Requests for material sourcing. Include the project and a useful due date so the receiving team can act without asking for context.' },
      { title: 'Close the loop', body: 'When work is complete, close the milestone with the actual date. If it was late, record the reason so the project history remains useful.' },
    ],
  },
  Engineering: {
    title: 'Engineering', icon: CalculatorIcon,
    intro: [
      'Engineering converts the agreed scope into calculations, drawings, and a technically complete Bill of Materials. Your output is the reference that Procurement, Stores, Production, QC, and Dispatch depend on.',
      'Keep technical facts in the project record, not only in email or personal files. A good Engineering record makes the next department’s job obvious.',
    ],
    features: [
      feature('scope', 'Scope of Supply', FileInputIcon, ['Review the released scope before starting detailed work. If the scope is unclear, raise the question as a task instead of silently making a commercial assumption.']),
      feature('calc', 'Calculation workspace', CalculatorIcon, ['Use Methodology for approved formulas, Variables for inputs, Tables for reference data, Validations for guardrails, and Snapshots for frozen calculation results.', 'A snapshot preserves the calculation as it was run. Use Reproduce or the Audit area when someone asks why a result changed.']),
      feature('drawings', 'Drawings and release', RulerIcon, ['Track drawing numbers, revisions, approvals, and as-built status with the project. Upload the file only after checking that the revision label matches the record.', 'Released calculations and drawings are the handoff signal to the shop; do not leave the project in an ambiguous review state.']),
      feature('bom', 'Master BOM', ClipboardListIcon, ['Import a PMB workbook and inspect the preview before confirming. Technical columns include description, MOC, size/spec, make, quantity, section, group, and remarks.', 'Procurement owns purchase status and references; Stores owns receipt fields; Production owns issued/received fields. Do not overwrite another department’s operational fields.']),
      feature('requests', 'Material requests', FileTextIcon, ['Use Requests for a new item or a quantity that must be sourced. Add enough technical detail for a buyer to obtain comparable quotes.', 'If an existing BOM line is wrong, correct the definition first; do not create a duplicate request to work around bad data.']),
      feature('milestones', 'Milestones and tasks', ListChecksIcon, ['Use milestones for major Engineering deliverables and Tasks for small follow-ups. Close both with real dates so downstream teams see the handoff clearly.']),
    ],
    howTo: [
      { title: 'Read the order', body: 'Open the project, review Scope of Supply, and check the project description and Sale Order context before starting calculations.' },
      { title: 'Run and freeze a calculation', body: 'Enter inputs, resolve validation warnings, run the sheet, and save a snapshot with a meaningful note or revision reference.' },
      { title: 'Prepare the BOM', body: 'Import the PMB, check skipped rows and mapped columns, then confirm. Correct the technical definition before Procurement starts sourcing.' },
      { title: 'Request a new material', body: 'Open Requests, select the project, describe the item, include size/MOC/quantity, and submit it to Procurement.' },
      { title: 'Release responsibly', body: 'Update drawing status, close the Engineering milestone, and add a task for any known follow-up instead of hiding it in a note.' },
    ],
  },
  Procurement: {
    title: 'Procurement', icon: ShoppingCartIcon,
    intro: [
      'Procurement turns BOM requirements into supplier quotes, selected suppliers, purchase orders, and reliable delivery status. The same material may serve several projects, so the Procurement workspace is cross-project.',
      'The key habit is to keep the commercial trail complete: request, comparison, supplier, PO, transit, and receipt should be understandable to someone who was not present when the decision was made.',
    ],
    features: [
      feature('enquiry', 'Enquiry queue', SearchIcon, ['Start with Enquiry items and Requests from Engineering, Design, or Stores. Confirm the technical description before contacting suppliers.', 'Use the project and source fields to separate normal project demand from In-Stock or Sold-As-Such demand.']),
      feature('quotes', 'Comparison and quotes', GitCompareIcon, ['Record each supplier quote with price, unit, payment terms, validity, and notes. Multiple quotes create a comparison trail rather than one unexplained price.', 'Do not delete a quote just because it lost; the history helps explain the final choice.']),
      feature('supplier', 'Supplier selection', Building2Icon, ['Select the supplier only after checking price, validity, terms, and technical fit. The selected quote becomes the basis for the draft PO.', 'If the requirement changes, update the BOM or request and leave a note rather than silently changing the supplier decision.']),
      feature('po', 'Purchase Orders', FileTextIcon, ['Review draft PO lines, issue the PO when the commercial details are correct, and generate the PDF for the supplier.', 'A PO issue moves the item into the next operational stage. Treat unissue/void actions as controlled corrections, not casual edits.']),
      feature('status', 'Status and delivery', TruckIcon, ['Use the status view to follow Enquiry, Comparison, Ordered, Transit, Received, Cancelled, and In-Stock. The summary also considers quote and supplier signals when the editable status cell is behind.', 'Keep PR/PO references readable because Stores and Production use them downstream.']),
      feature('requests', 'New-item requests', ClipboardListIcon, ['Requests land directly in the Enquiry flow. Accept the requirement by sourcing it, not by creating a second manual record.', 'Ask the requesting team for missing technical information through a task so the request remains traceable.']),
    ],
    howTo: [
      { title: 'Work a new enquiry', body: 'Open Enquiry, confirm the requirement and project, contact suitable suppliers, and record each quote with comparable units and terms.' },
      { title: 'Compare and select', body: 'Review quote history, choose the technically and commercially suitable quote, and check the draft PO before issuing it.' },
      { title: 'Issue the PO', body: 'Confirm supplier, lines, quantities, rates, terms, and delivery information. Issue the PO and send the generated PDF through the approved channel.' },
      { title: 'Track delivery', body: 'Move the item through Ordered and Transit as the supplier confirms dispatch. Keep PO references current so Stores can match the receipt.' },
      { title: 'Close or cancel', body: 'When Stores confirms receipt, use Received. If an item must be cancelled, follow the cancellation flow and handle any PO void with the supplier.' },
    ],
  },
  Stores: {
    title: 'Stores', icon: WarehouseIcon,
    intro: [
      'Stores is the physical truth of material: what is on hand, what is reserved, what arrived, and what is still pending. Accurate receipt data prevents both shortages and false availability.',
      'Use Inventory for stock work, Projects/BOM for project context, and Requests when a new material requirement needs Procurement attention.',
    ],
    features: [
      feature('inventory', 'Inventory', BoxesIcon, ['Inventory shows on-hand quantity and the quantity reserved for active project requirements. Available stock is the usable balance after reservations.', 'Keep item names and units consistent so the same stock is not entered twice under slightly different names.']),
      feature('reserve', 'Reservations', ClipboardCheckIcon, ['Reserve stock against a BOM requirement when material is committed to a project. A reservation reduces available stock without pretending the material has already been issued.', 'Release a reservation when the requirement is cancelled or fulfilled another way.']),
      feature('receipt', 'GRN and receipt fields', PackageCheckIcon, ['On the BOM, record GRN reference, quantity received, pending quantity, and BQ-TC reference. These fields tell the rest of the system what physically arrived.', 'Use clear dates and quantities; do not write a total in a field that means pending balance.']),
      feature('sas', 'In-Stock and SAS material', BoxesIcon, ['Stock and Sold-As-Such items can follow the same sourcing and status flow without being attached to a normal project milestone chain.', 'Check the source and project context before issuing stock so the inventory movement remains auditable.']),
      feature('tasks', 'Tasks and handoffs', ListChecksIcon, ['Use Tasks for a missing document, a receipt question, or a delivery follow-up. Close the task when the physical or documentary action is complete.']),
    ],
    howTo: [
      { title: 'Receive material', body: 'Match the delivered material to the PO/BOM, record GRN reference and date, enter quantity received, and update the pending balance.' },
      { title: 'Reserve stock', body: 'Find the project requirement, choose the inventory item, enter the quantity, and confirm the reservation. Check available balance before promising stock.' },
      { title: 'Issue material', body: 'Confirm the project and quantity, then record the issue reference/date in the Production-owned fields when the material leaves Stores.' },
      { title: 'Handle a mismatch', body: 'Do not force a receipt into the wrong line. Raise a task to Procurement or Engineering with the PO, material description, and actual quantity.' },
      { title: 'Close the loop', body: 'Make sure the BOM receipt fields, inventory quantity, and reservation state agree before closing the Stores task.' },
    ],
  },
  Production: {
    title: 'Production', icon: HardHatIcon,
    intro: [
      'Production uses the project milestone chain and material signals to plan and record shop-floor execution. The goal is a truthful view of what has started, what is blocked, and what material was actually used.',
      'Tasks is your calendar for daily work. Operations is the cross-project view. Workers is the shop-floor attendance and assignment sheet for people who do not log into Shanti Ops.',
    ],
    features: [
      feature('tasks', 'Tasks calendar', CalendarDaysIcon, ['Tasks shows monthly, weekly, and yearly views for your granted departments. It combines milestone dates with ordinary follow-up tasks.', 'Use a due date and assignee for every action that someone must remember. Cross-department tasks show the sending department when relevant.']),
      feature('milestones', 'Production milestones', RouteIcon, ['Start a milestone when work begins and close it when the work is complete. Closing late asks for a reason so the project history explains the delay.', 'Use stages/checklists inside a milestone for repeatable steps without inventing many new milestones.']),
      feature('bom', 'Issued and received material', ClipboardListIcon, ['Record issued and received references on the BOM as material moves into work. These are operational references, not a replacement for Stores inventory records.', 'Check MOC, size, quantity, and section before issuing material to avoid using the wrong line.']),
      feature('workers', 'Workers and attendance', UsersIcon, ['Workers is for shop-floor people who do not have user accounts. Mark present, half-day, or absent for the selected date and record the project/task they worked on.', 'Keep worker names and trades current; deactivate rather than delete a historical worker.']),
      feature('handoff', 'Department handoffs', MessageSquareIcon, ['Use tasks and notifications when Production needs a response from QC, Stores, Dispatch, or another department. A closed milestone should create a visible next action where configured.', 'Do not close a blocked job just to remove it from the screen; record the blocker and delay reason.']),
    ],
    howTo: [
      { title: 'Plan today', body: 'Open Tasks, choose the department/date view, and review open tasks, milestone dates, and overdue work before assigning new actions.' },
      { title: 'Start work', body: 'Open the project milestone, confirm material readiness, start the work, and add a task for any dependency that could stop the job.' },
      { title: 'Record material use', body: 'Update issued and received references with the real quantity/date. Ask Stores to correct receipt data instead of overwriting it from Production.' },
      { title: 'Update workers', body: 'Open Workers, choose the date, mark attendance, and add project/work assignment details while the day is still fresh.' },
      { title: 'Close correctly', body: 'Close the milestone only when complete. If late, choose the delay reason; if another department must act, raise a task before closing.' },
    ],
  },
  QC: {
    title: 'Quality Control', icon: FlaskConicalIcon,
    intro: [
      'QC records whether the product and its supporting documents meet the required checks. Your records should let a manager answer three questions: what was tested, what was the result, and which document proves it?',
      'Use project QC for work on a specific order, the Certificate bank for reusable material certificates, and the milestone/task views for daily inspection work.',
    ],
    features: [
      feature('tests', 'Test records', ClipboardCheckIcon, ['Create a record for hydro tests, NDE/radiography, MTC checks, and other inspections. Include test type, reference number, result, inspector, date, and notes.', 'Use Pending until the check is actually completed. A clear Fail result should include the reason or next action.']),
      feature('certificates', 'Test Certificate bank', BadgeCheckIcon, ['Enter a certificate once with its certificate number, maker/cast/plate details, material data, and uploaded PDF when available.', 'Link certificates to the relevant project or part so the same material evidence can be found later without duplicate entry.']),
      feature('statutory', 'Statutory documents', FileTextIcon, ['Use the statutory document editor for the supported Form IV A workflow. Header data and part rows are kept together so the PDF reflects the saved record.', 'Do not advance a document with missing required fields; the PDF gate is there to prevent incomplete evidence being treated as final.']),
      feature('milestones', 'QC milestones', RouteIcon, ['Start and close QC milestones with actual dates. When work is late or failed, record the reason and create the follow-up task.', 'A QC result and a milestone are related but not identical: use the test record for the evidence and the milestone for project progress.']),
      feature('handoff', 'Release and sign-off', ShieldCheckIcon, ['Make the result and supporting references clear for Production, Dispatch, Management, and the customer-facing record. Keep rework visible instead of silently editing a passed record.']),
    ],
    howTo: [
      { title: 'Create the inspection record', body: 'Open the project QC area, choose the test type, enter reference and inspector details, and leave the result Pending until the check is complete.' },
      { title: 'Record a result', body: 'Enter the tested date and result, then add notes that explain any failure, limitation, re-test, or acceptance condition.' },
      { title: 'Store evidence', body: 'Add or find the relevant Test Certificate or statutory document and check that the PDF uses the saved data.' },
      { title: 'Raise rework', body: 'If the result fails, record the reason and raise a task for the responsible department. Do not hide the failure by deleting the record.' },
      { title: 'Close the QC handoff', body: 'Close the QC milestone only when the inspection and evidence are complete, then confirm the next department can find the references.' },
    ],
  },
  Dispatch: {
    title: 'Dispatch', icon: TruckIcon,
    intro: [
      'Dispatch turns completed project material into a controlled packing and delivery record. The packing list is the bridge between the BOM and what the customer actually receives.',
      'Use Operations → Dispatch or the Dispatch tab to see the board. Use Projects when you need the order context and the BOM source lines.',
    ],
    features: [
      feature('board', 'Packing board', PackageCheckIcon, ['The board groups packing lists by Draft, Ready, and Dispatched. Use the status to tell the team whether a list is still being prepared, approved for delivery, or already sent.', 'Keep one person responsible for the final status so two people do not dispatch the same list.']),
      feature('generate', 'Generate from BOM', ClipboardListIcon, ['Create a draft from BOM lines that have not already been carried into a non-draft packing list. Partial dispatches are supported.', 'Review quantities and descriptions before editing box numbers and package details.']),
      feature('packing', 'Packing details', BoxesIcon, ['Add box number, quantity, unit, MOC, size/spec, item code, ibr number, make, and scanned quantity as applicable.', 'Scanned quantity is a physical check; it should not silently exceed the BOM quantity without an explanation.']),
      feature('pdf', 'Packing PDFs', FileTextIcon, ['Generate the customer-facing PDF when the list is Ready. Use the pending-list PDF when you need a list of lines still waiting to be packed.', 'Check customer name, address, invoice/DC details, vehicle, and dispatch method before issuing the document.']),
      feature('reconcile', 'BOM reconciliation', ClipboardCheckIcon, ['A packing item keeps a link to its BOM line. Use that link to explain what was carried, what remains pending, and why a partial list was created.']),
    ],
    howTo: [
      { title: 'Create the list', body: 'Open Dispatch, generate a draft from the project BOM, and confirm that only the intended pending lines were included.' },
      { title: 'Pack physically', body: 'Fill box/package details, enter actual packed or scanned quantities, and check the physical count against the list.' },
      { title: 'Complete the header', body: 'Enter customer/address, invoice or DC, vehicle, contact, and dispatch-through details before changing the status.' },
      { title: 'Release the document', body: 'Move the list to Ready only after the contents and header are checked, then generate the PDF.' },
      { title: 'Close dispatch', body: 'After the vehicle leaves, move the list to Dispatched and keep the PDF with the customer/order record.' },
    ],
  },
  Installation: {
    title: 'Installation', icon: MapPinIcon,
    intro: [
      'Installation tracks the work that happens at the customer site after manufacturing and dispatch. The project record should show what is planned, what the site team completed, and what is still waiting on the customer or another department.',
      'Use Operations for your open site work, Projects for the order record, and Tasks for site-specific follow-ups.',
    ],
    features: [
      feature('milestones', 'Site milestones', RouteIcon, ['Start and close installation, commissioning, and site milestones with actual dates. Use planned dates to make the expected visit visible early.', 'If a date moves, record the reason so the customer-facing progress story remains honest.']),
      feature('tasks', 'Site tasks', ListChecksIcon, ['Use tasks for access arrangements, foundation readiness, customer documents, travel, tools, and punch-list items.', 'Assign each task to a person or receiving department and include the project in the task.']),
      feature('handoff', 'Handoffs', MessageSquareIcon, ['Use cross-department tasks when Installation needs Dispatch, QC, Production, or Management to act. Close the task only after the receiving action is confirmed.', 'Keep customer commitments in the project record, not only in a private message.']),
      feature('progress', 'Customer progress', FolderKanbanIcon, ['The customer portal reads project progress from milestones. Accurate actual dates and delay reasons improve the customer view without extra reporting work.']),
    ],
    howTo: [
      { title: 'Prepare the visit', body: 'Open the project, review the next site milestone, and create tasks for access, material, travel, tools, and customer readiness.' },
      { title: 'Start site work', body: 'Start the milestone when the team begins. Add a note or task for anything discovered on site that needs follow-up.' },
      { title: 'Manage a blocker', body: 'Record the delay reason and raise the task to the right department. Do not close the milestone while the blocker is unresolved.' },
      { title: 'Complete commissioning', body: 'Enter actual end date, close the milestone, and ensure any punch-list task is either completed or clearly assigned.' },
      { title: 'Confirm the customer view', body: 'Check that the project progress and estimated dates now tell the same story as the site record.' },
    ],
  },
  Sales: {
    title: 'Sales', icon: TrendingUpIcon,
    intro: ['Sales manages the commercial journey from qualified enquiry to confirmed Sale Order. The CRM keeps customers, contacts, quotations, and orders connected so the factory receives a clean handoff.', 'Marketing shares Leads, Campaigns, Pipeline, Tasks, and Reports. Sales additionally owns Customers, Quotations, and Sale Orders.'],
    features: [
      feature('leads', 'Leads', UserPlusIcon, ['Capture the person/company, contact details, source, territory, and industry. Move the status as the conversation progresses.', 'Convert a qualified lead to create a Customer and Opportunity together; this prevents duplicate typing.']),
      feature('pipeline', 'Pipeline', TrendingUpIcon, ['Move opportunities through the configured stages. Keep value, probability, expected close, next contact date, and lost reason current.', 'An opportunity is the active deal; a lead is still an enquiry. Do not leave won work sitting as an open opportunity.']),
      feature('customers', 'Customers and contacts', Building2Icon, ['Keep the commercial party, people, and addresses in one place. Reuse these records in quotations and orders instead of creating near-duplicates.']),
      feature('quotations', 'Quotations', FileTextIcon, ['Build the proposal with real line items, rates, taxes/terms as applicable, then generate the PDF. Convert an accepted quotation to a Sale Order.']),
      feature('sale-orders', 'Sale Orders', ShoppingCartIcon, ['The Sale Order is the confirmed commercial order. Linking it to a Project creates the Design/Engineering Scope of Supply handoff.']),
      feature('tasks', 'Tasks, notes, and calls', PhoneIcon, ['Log the outcome and next step after every meaningful contact. Add tasks with due dates instead of relying on memory.']),
      feature('reports', 'Reports', BarChart3Icon, ['Use Sales Pipeline, By Department, Lead Funnel, Source, and Campaign reports to keep the funnel honest. Reports can be printed to PDF from the browser.']),
    ],
    howTo: [
      { title: 'Capture an enquiry', body: 'Create a Lead with the best contact details and source you have. Add a follow-up task immediately.' },
      { title: 'Qualify it', body: 'Log calls/notes, confirm requirement and timing, and move the lead status to qualified when it is a real opportunity.' },
      { title: 'Create the commercial record', body: 'Convert the lead, work the Opportunity, create a Quotation with real line items, and generate the PDF.' },
      { title: 'Confirm the order', body: 'Convert the accepted quotation to a Sale Order and check customer/address details before linking it to a Project.' },
      { title: 'Hand off cleanly', body: 'Link the Sale Order to the Project and add any commercial note or task that Design/Engineering must know.' },
    ],
  },
  Marketing: {
    title: 'Marketing', icon: MegaphoneIcon,
    intro: ['Marketing creates demand, captures enquiries, and helps the team understand which campaigns produce useful opportunities. Your main workspace is the shared CRM funnel, not the Sales-only order paperwork.', 'Sales shares Leads, Pipeline, Tasks, and Reports. Marketing owns Campaigns and can work the shared upstream funnel; Customers, Quotations, and Sale Orders remain Sales-owned.'],
    features: [
      feature('campaigns', 'Campaigns', MegaphoneIcon, ['Create a campaign for a trade show, referral drive, website push, paid campaign, or other source of enquiries.', 'Attach the campaign to Leads and Opportunities so Reports can show what it produced.']),
      feature('leads', 'Leads', UserPlusIcon, ['Capture every useful enquiry with source, company, contact details, industry, and territory. Keep the source accurate because it powers campaign reporting.', 'Marketing can qualify and hand a lead into the shared pipeline; do not create a second Lead because Sales also needs to see it.']),
      feature('pipeline', 'Shared Pipeline', TrendingUpIcon, ['Follow opportunities after a lead becomes a real deal. Keep next contact, expected close, value, and stage current so Sales and Marketing see the same truth.', 'Use a real lost reason when an opportunity ends.']),
      feature('tasks', 'Tasks and follow-up', ListChecksIcon, ['Create follow-ups for campaign responses, callbacks, event contacts, and content actions. Assign the task and set a due date.', 'Close completed tasks rather than deleting them; the history shows what happened.']),
      feature('reports', 'Marketing reports', BarChart3Icon, ['Use Lead Funnel, Leads by Source, and Campaign Performance to compare campaign activity with lead volume and opportunity value.', 'Reports are a decision aid, not a substitute for accurate source and campaign fields.']),
      feature('team', 'Team and assignment rules', UsersIcon, ['Set the Marketing assignment rota if your team uses round-robin lead assignment. Leave it blank when a person should assign leads manually.', 'You manage Marketing’s assignment list, not Sales’ list.']),
    ],
    howTo: [
      { title: 'Plan a campaign', body: 'Create the Campaign with a clear name and purpose before importing or entering leads. Use the same campaign name everywhere.' },
      { title: 'Capture responses', body: 'Create or update Leads with a source and campaign, then add a follow-up task so every response has an owner.' },
      { title: 'Qualify and share', body: 'Move real requirements to qualified and let the shared Pipeline carry the deal forward. Do not duplicate the record for Sales.' },
      { title: 'Review results', body: 'Open Reports and compare leads, sources, campaigns, and opportunity value. Fix missing attribution before drawing conclusions.' },
      { title: 'Hand off a ready deal', body: 'Add a useful note and next step, assign the opportunity if needed, and let Sales handle customer, quotation, and Sale Order paperwork.' },
    ],
  },
  HR: {
    title: 'Human Resources', icon: UsersIcon,
    intro: ['HR keeps the people record accurate from joining to leaving: employee details, onboarding, attendance, leave, payroll inputs, expenses, advances, and separation.', 'HR data is sensitive. Check the employee and date before saving changes, and use the workflow status instead of deleting history.'],
    features: [
      feature('employees', 'Employees', UserRoundIcon, ['The employee master is the central people record. Keep department, designation, contact, joining, manager, and employment status current.', 'Use deactivate/separation workflows rather than deleting a historical employee.']),
      feature('onboarding', 'Onboarding', UserCheckIcon, ['Create onboarding tasks for documents, induction, equipment, and approvals. Mark each task complete as evidence arrives.', 'The employee should be visible to the right department before access or work is assigned.']),
      feature('attendance', 'Attendance and shifts', Clock3Icon, ['Use shifts and attendance to record the working day. Check the date and assigned shift before correcting an entry.', 'Attendance is date-specific; do not treat today’s status as a permanent employee property.']),
      feature('leave', 'Leave and holidays', CalendarDaysIcon, ['Maintain leave types, allocations, holidays, and requests. Approve only after checking balance, dates, and reporting responsibility.', 'A rejected or cancelled request remains part of the record.']),
      feature('payroll', 'Payroll', IndianRupeeIcon, ['Salary structures, assignments, additional salary, advances, loans, and statutory slabs feed payroll runs and salary slips.', 'Review the run before generating slips; payroll is a controlled calculation, not a free-form edit.']),
      feature('expenses', 'Expenses and separation', ReceiptIcon, ['Review expense claims and advances with supporting details. For separation, complete tasks and settlement steps before closing the employee record.']),
    ],
    howTo: [
      { title: 'Onboard someone', body: 'Create or open the employee, confirm department/designation, add onboarding tasks, and track documents until every required task is complete.' },
      { title: 'Correct attendance', body: 'Choose the employee and exact date, check the shift assignment, then correct the attendance record with a clear reason.' },
      { title: 'Process leave', body: 'Review the request dates and balance, check holidays/overlap, then approve or reject with the correct workflow action.' },
      { title: 'Run payroll', body: 'Check salary assignments, additions, loans, advances, and statutory settings; generate the run, review totals, then generate slips.' },
      { title: 'Complete separation', body: 'Open the separation record, finish tasks, calculate settlement, review the result, and only then deactivate/close the employee.' },
    ],
  },
};

enrichHowTo();

// Keep the department list in one place for the Help renderer and simple future additions.
export const DEPARTMENT_HELP_ORDER = ['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation', 'Sales', 'Marketing', 'HR'];
