// Department help content for /help. This is intentionally plain data: the renderer owns layout,
// while each department owns its vocabulary, feature order, and practical how-to guidance.
import {
  BookOpenIcon, ClipboardListIcon, CalculatorIcon, FolderKanbanIcon, FileInputIcon,
  RulerIcon, DraftingCompassIcon, SearchIcon, GitCompareIcon, FileTextIcon, TruckIcon,
  WarehouseIcon, PackageCheckIcon, BoxesIcon, UsersIcon, CalendarDaysIcon, HardHatIcon,
  FlaskConicalIcon, BadgeCheckIcon, ClipboardCheckIcon, MapPinIcon, RouteIcon, ShoppingCartIcon,
  UserPlusIcon, Building2Icon, MegaphoneIcon, TrendingUpIcon, PhoneIcon, BarChart3Icon,
  UserRoundIcon, UserCheckIcon, Clock3Icon, IndianRupeeIcon, ReceiptIcon, ShieldCheckIcon,
  ListChecksIcon, MessageSquareIcon, WrenchIcon, BellIcon, TagIcon, InboxIcon, UndoIcon,
  ScissorsIcon, ClipboardIcon, AlertTriangleIcon, LogInIcon, FileOutputIcon,
  HeadsetIcon, FileSignatureIcon, LayersIcon, Repeat2Icon, FileEditIcon, Undo2Icon,
  LandmarkIcon, PercentIcon, BookIcon, LockIcon,
} from 'lucide-react';

// Milestone Tracker (2026-08-17) — most milestones now complete themselves off a real event
// instead of waiting for someone to open the status drawer (lib/milestone-auto.js is the single
// source of truth this table mirrors). Shared shape so every manufacturing department's guide
// renders the same table via GuideBody's existing `table` field — no new renderer needed.
function milestoneTrackerFeature(rows) {
  return feature('milestone-tracker', 'Milestone Tracker', Clock3Icon, [
    'Most of your milestones no longer need someone to open the status drawer and mark them done by hand — they complete themselves the moment the real underlying work actually finishes, the same way the rest of the app already tracks that work.',
    'A milestone still shown as "Explicit action" has no reliable signal elsewhere in the app to detect completion from — it needs a real person to say so, but through a dedicated button instead of the generic status editor.',
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
    value: 'The drawing record connects the file on someone’s computer to the project revision that other departments use. It prevents Production from building from an old or unidentified file.',
    outcome: 'The current drawing number, revision, status, and file agree, and the next team can tell which drawing is approved for use.',
    checklist: ['Use the project’s drawing number and revision convention.', 'Update status when the file moves through review, approval, or as-built stages.', 'Add a task when another person must review or correct the drawing.'],
    watchOut: 'Uploading a newer file without changing the revision creates a false sense of control. The revision label and the stored record must match.',
  },
  bom: {
    value: 'The BOM is the material contract between technical design and execution. It tells Procurement what to source and gives Stores, Production, QC, and Dispatch a common item identity.',
    outcome: 'Every required line has a usable description, specification, quantity, section, and ownership-aware downstream fields.',
    checklist: ['Preview imports before confirming them.', 'Check description, MOC, size/specification, make, quantity, section, and group.', 'Link a line to its Item Master catalog entry if the import missed it — use the "Not linked to catalog" filter to find them.', 'Leave Procurement, Stores, and Production-owned operational fields to those teams.'],
    watchOut: 'Do not fix a technical mistake by creating a duplicate line. Correct the source definition and review the impact on quotes, receipts, and packing. A line that already has a receipt or issue against it can\'t be re-linked to a different catalog item — that protection is intentional, not a bug.',
  },
  bomStructure: {
    value: 'Multi-Level BOM turns a flat list of parts into real assemblies and sub-assemblies with a quantity multiplier, so a boiler’s "2 ID Fans, each with 1 Drive sub-assembly" is a structure the system can roll up, not just three separate lines a reader has to mentally group.',
    outcome: 'Every assembly shows the multiplied quantity of everything nested under it, computed live from the tree — never hand-typed and never out of date when a parent quantity changes.',
    checklist: ['Create the assembly (or sub-assembly, nested under a parent) before assigning items to it.', 'Assign a BOM item to its assembly from the Edit dialog on the project’s BOM table, not here.', 'Check the roll-up quantity, not just the item’s own qty_text, before treating a count as final.'],
    watchOut: 'A BOM item left unassigned (no assembly) still works exactly as before — assigning it to a structure is optional, not a requirement to keep using the BOM.',
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
    value: 'Receipt fields record what physically arrived, not what was ordered. They let Stores and Production see the remaining balance and locate the supporting GRN or certificate.',
    outcome: 'GRN reference, date, received quantity, pending quantity, and certificate reference tell the same story.',
    checklist: ['Match the delivery to the PO and BOM line.', 'Enter actual received quantity and date.', 'Recheck the pending balance after partial receipts.'],
    watchOut: 'Do not enter the ordered total in a received field or leave a partial delivery looking complete.',
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
  jobcards: {
    value: 'A Job Card is one real piece of shop-floor work — an operation against an actual project milestone, not a free-typed description. It is where planning becomes an auditable record of who did what, on which machine, for how long, and at what cost.',
    outcome: 'The card carries a real milestone, a workstation where relevant, logged hours against named workers, any consumables used, and a quantity/status that is true right now — not what was planned three weeks ago.',
    checklist: ['Create the card against the actual milestone, not a guessed one — the project/milestone picker is the only way in, so the fabrication percentage stays accurate.', 'Log hours in real sessions as they happen, not one lump total at the end of the week.', 'Flag subcontracted or site work with the Outside/Site markers instead of leaving them looking like ordinary shop work.'],
    watchOut: 'Do not leave a card sitting in Pending once work has actually started, and do not close it out with an invented quantity just to clear the board — a wrong Done count breaks the fabrication percentage every other view relies on.',
  },
  workorders: {
    value: 'A Work Order is the production order itself — the record that says what you are making, how much, by when, and against which project or stock need, before any Job Card exists. Job Cards are still where the actual work gets logged; the Work Order is what authorizes and tracks them as a set.',
    outcome: 'A released Work Order has a real route (each step tied to a workstation and, where it applies, a milestone), a material list with real quantities, and a full set of generated Job Cards — so its progress bar, delay flag, and costing are all trustworthy, not guesses.',
    checklist: [
      'Pick the right mode first: Against a customer order needs a project (and pulls its BOM); Against stock needs neither, just a product description.',
      'Build the full route before you release — operation, workstation, and planned minutes for every step — because routing locks the moment the Work Order leaves draft.',
      'Click Generate Job Cards once, right after releasing, instead of creating the cards by hand — it reads the route card so nothing gets missed or duplicated.',
      'Use a Change Note (not a plain edit) for quantity, dates, or product description once the Work Order is released — that is the only way those changes stay in the record.',
    ],
    watchOut: 'A route step with no workstation set will never show up in Forecast\'s workstation load, and a material line with no quantity or BOM link will never show real progress — an empty-looking Work Order is usually one you released before finishing the route or materials, not a sign nothing needs to happen.',
  },
  forecast: {
    value: 'Forecast turns your open Work Orders into a look-ahead: what is coming due, which workstations are getting overloaded, and which materials are still short — all read live off real Work Orders, not typed in separately.',
    outcome: 'A department head can see the next 30 days of load and shortage at a glance, before it becomes a missed date on the shop floor.',
    checklist: [
      'Treat an empty Forecast as a signal to check Work Orders, not proof there is nothing coming — only released/in-progress Work Orders with planned dates, routed steps, and material lines actually appear here.',
      'Re-route or flag for an extra shift as soon as a workstation shows Overloaded, rather than waiting for the delay to actually happen.',
      'Chase the specific outstanding material shown here with Stores/Procurement instead of a general "are we on track" check.',
    ],
    watchOut: 'Overloaded is a flat single-shift-per-day estimate, not a real shift calendar — treat it as an early warning, not an exact number.',
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
    value: 'Material issued to WIP is the record of what physically left Stores for the shop floor — separate from the on-hand/purchase-status bookkeeping Reserve and Issue already handle, and separate from Production\'s own issued/received BOM fields. It exists because "Stores handed this over" is a real event worth a timestamp and a name, even when nothing else in the system needs to change because of it.',
    outcome: 'Anyone looking at a project later can see exactly what left Stores, when, how much, and who logged it — without relying on memory or a side conversation with Production.',
    checklist: ['Pick the real project and BOM item, not a close-sounding one.', 'Log the quantity that actually physically moved, not the full requirement.', 'Log it close to when it happened — a week-old backfill is much easier to get wrong.'],
    watchOut: 'This log does not reserve, receive, or issue anything by itself — it has no effect on Inventory\'s on-hand/available numbers or the BOM line\'s purchase status. Use Reserve/Issue for that; use this only as the physical-handoff record.',
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
      feature('scope', 'Scope of Supply', FileInputIcon, ['Read the work order created from a confirmed Sale Order. Confirm what the boiler, equipment, or package includes before detailed design starts.', 'Keep the scope clear and practical: what is included, what is excluded, and what the customer must provide. Release it only after Design and Engineering agree.']),
      feature('calc', 'Calculation Sheets', CalculatorIcon, ['Open Calc Sheets from the Design or Engineering tab and choose the project. Inputs, formulas, validations, snapshots, and review status stay attached to that project.', 'Save a snapshot when a calculation is ready for review. A snapshot is the frozen record of the exact inputs and formula versions used.']),
      feature('drawings', 'Drawings', RulerIcon, ['Use the Drawings panel to keep drawing files and their status with the calculation work. This is a release tracker, not a CAD editor.', 'Use clear drawing numbers and revision notes so Production can tell which file is current.']),
      {
        key: 'notifications', label: 'Notifications', icon: BellIcon, group: true,
        body: ['There are three notification paths for Design. Customer covers the customer’s comments and approvals. Internal (Design) covers handoffs that stay entirely inside Design. External (Departments) covers every signal that crosses a department or commercial boundary — Sales, Procurement, PM tier.'],
        children: [
          feature('notifications-customer', 'Customer', BellIcon, [
            'A drawing only reaches the customer because a Design Head chose to share it. The "Share with customer" checkbox on each drawing in the Drawings panel is Head-only. A Designer cannot toggle it, same as approving a drawing.',
            'The effect is immediate once switched on. The customer can open the file, read and reply in the comment thread, and, once the drawing is Under review, approve it right away. There is no waiting period on that side.',
            'Only a drawing that has actually reached Under review, Approved, or As built becomes visible, even with the toggle on. A Not started or In progress drawing stays internal regardless of the toggle, so sharing early does not leak unfinished work.',
            'The customer’s order-progress screen reflects this with no extra words. The Design & Engineering step turns from blue to amber with a clock icon whenever a shared drawing is sitting Under review and waiting on them. Only the color and icon change; the label still just says "In progress."',
            'A notification is not sent instantly. It fires five minutes after the toggle is switched on, and only if it is still on at that point. Flip it off within those five minutes, for an accidental click, and nothing is ever sent. Flip it on again later and the five-minute clock restarts.',
            'The comment thread is shared, not duplicated. What you write in the Drawings panel and what the customer writes in their portal land in the same thread. Each message is tagged "Customer" when it is theirs, so it is always clear who said what.',
            'Today this notification is in-system only. The customer sees it in their own portal bell. WhatsApp delivery is planned as an addition later, not a replacement for this.',
          ], {
            value: 'The customer-visible toggle is a release gate, separate from your own Under review or Approved status. It exists so a drawing can be technically ready in the system before a Design Head has actually decided the customer should see it.',
            outcome: 'The customer sees exactly the drawings a Design Head chose to share, can act on them the instant they are shared, and is notified once, not on every click, five minutes after a genuine, sustained toggle-on.',
            checklist: [
              'Turn the toggle on only when the drawing is genuinely ready for the customer to review. Turning it on does not itself change the drawing’s status.',
              'Expect the customer to be able to act immediately. Do not treat the five-minute delay as a window to undo a real share.',
              'Read the customer’s comments in the same Drawings panel thread. There is no separate customer inbox to check.',
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
      feature('bom', 'Material definition and BOM', ClipboardListIcon, ['Define the material description, MOC, size/specification, make, quantity, section, and group label. Engineering/Design owns the technical definition; downstream teams add purchasing and receipt information.', 'Import the PMB workbook, review detected rows and skipped rows, then confirm. Never replace a live BOM without checking the revision preview.']),
      feature('remnant', 'Cutting & Remnant Matching', ScissorsIcon, [
        'For any plate, MS section, or angle line, Category + numeric dimensions are what let the system automatically check that line against remnants already sitting in Stores the moment you release the BOM.',
        'A match reserves the physical piece and quietly keeps that line out of Procurement — it still looks like a normal BOM line to you, nothing extra to check or click on your side.',
      ], {
        checklist: [
          'When you add a plate/section BOM line, pick its Category and fill in Length/Width/Thickness (and MOC) — a line without these is simply invisible to matching, no error, it just goes to Procurement like before.',
          'Release the BOM the normal way: Requests → Release BOM → pick the project → Release BOM. Matching runs automatically the instant you release — there is no separate step or button for it.',
          'You do not need to check whether a line matched. Stores sees a "Remnant reserved" badge and Production sees a ready-to-cut piece; your BOM view looks the same either way.',
        ],
      }),
      milestoneTrackerFeature([
        ['Design', 'Explicit action', 'The Design Head clicks "Approve Design" on the project\'s Design tab — an internal sign-off with no other data signal to detect it from.'],
        ['Submit Design Approval', 'Automatic', 'Completes once every customer-visible drawing on the project has been approved by the customer — the same per-drawing approval already tracked in the Drawings panel, just rolled up.'],
        ['Release BOM / PR', 'Explicit action', 'Design or Engineering clicks "Release BOM" on the Requests → Release BOM tab, once the project actually has BOM items to release — this is also the moment Cutting & Remnant Matching checks every plate/section line against Stores.'],
        ['Release All Drawings', 'Manual only', 'No automatic or explicit-button trigger yet — close it from the milestone drawer once every drawing is genuinely released.'],
      ]),
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
      feature('bom', 'Master BOM', ClipboardListIcon, [
        'Import a PMB workbook and inspect the preview before confirming. Technical columns include description, MOC, size/spec, make, quantity, section, group, and remarks.',
        'Procurement owns purchase status and references; Stores owns receipt fields; Production owns issued/received fields. Do not overwrite another department’s operational fields.',
        'Import already tries to auto-link each line to the Item Master catalog on an exact name match — a line that doesn\'t show a catalog code (under the description) missed it, usually a typo, abbreviation, or formatting difference. Search and pick the real catalog entry for it — plain search only, no automatic suggestion, since a wrong guess here would feed Where-Used, Common/Uncommon, Inventory Aging, and Stock Ledger the wrong identity. Use the "Not linked to catalog" filter to find every line still needing this.',
      ]),
      feature('notifications', 'Notifications', BellIcon, [
        'You receive a notification the moment a new order reaches Engineering: converting a confirmed Sale Order into a Project (a Design Head or PM does the converting) notifies Engineering and Design at the same time, since a fresh Scope of Supply now exists for both to work from.',
        'You receive a notification when a BOM template is applied to a project — a reusable per-boiler-model starting BOM (Requests → Templates), applied by Design, Stores, or Engineering itself. If someone else applied it, this is how Engineering learns a BOM has taken shape without opening the project to check. If Engineering applied it, no notification is sent for that own action — same "you don\'t get pinged for your own work" pattern as Sales\' own Sale Order creation.',
        'Engineering owns no milestones of its own (Design owns the whole Design→BOM→Drawings chain), so unlike most departments there is no milestone-handoff traffic here — these two are genuinely the only notification types Engineering receives.',
        'This is the same bell every internal department uses, top right of the app. It is automatic for everyone with Engineering access; nothing here is a toggle you turn on or off.',
      ], {
        value: 'Before the BOM-template notification existed, Engineering had exactly one notification type — Scope of Supply creation — and no way to learn that a template had seeded a project\'s BOM unless someone mentioned it directly. This closes that gap without inventing a new milestone Engineering doesn\'t actually own.',
        outcome: 'Engineering can trust the bell to cover both moments a project\'s BOM meaningfully changes shape from outside its own hands — a brand-new order arriving, and a template being applied to one.',
        checklist: [
          'Treat a Scope of Supply notification as the cue to open the project and confirm the technical assumptions before detailed work starts, not just evidence the order exists.',
          'Treat a BOM-template notification as the cue to review what the template actually inserted — a template is a starting point, not a substitute for checking the real requirement.',
          'Do not expect a notification for routine BOM edits, drawing status changes, or milestone handoffs elsewhere in the project — those stay with the departments that own them.',
        ],
        watchOut: 'Marking a notification read only proves you saw it. A BOM-template notification still means the inserted lines need the same review as any other BOM content before Procurement starts sourcing against them.',
      }),
      feature('requests', 'Material requests', FileTextIcon, ['Use Requests for a new item or a quantity that must be sourced. Add enough technical detail for a buyer to obtain comparable quotes.', 'If an existing BOM line is wrong, correct the definition first; do not create a duplicate request to work around bad data.']),
      feature('milestones', 'Milestones and tasks', ListChecksIcon, ['Use milestones for major Engineering deliverables and Tasks for small follow-ups. Close both with real dates so downstream teams see the handoff clearly.']),
      feature('bomStructure', 'BOM Structure (assemblies)', LayersIcon, ['Open the Engineering tab (top nav) → BOM Structure to build and browse a project’s assembly tree — nest sub-assemblies, set a quantity multiplier per level, and see roll-up quantity computed live.', 'Assign a BOM item to an assembly from the project page’s BOM table (Edit item → Assembly), not from the Engineering tab itself.']),
      feature('whereUsed', 'Where-Used', SearchIcon, ['Open the Engineering tab → Where-Used, search a part description, and see every project (and assembly, where assigned) that carries a matching part.']),
      feature('commonUncommon', 'Common / Uncommon', Repeat2Icon, ['Open the Engineering tab → Common/Uncommon to see which parts are reused across 2+ projects versus used on exactly one — a starting point for stocking decisions, not a Stores action in itself.']),
      feature('ecn', 'Engineering Change Notes', FileEditIcon, ['Raise an ECN from the Engineering tab (or the project’s BOM table) whenever a released BOM field needs a controlled change — field, old value, new value, and a real reason.', 'A department Head approves or rejects; approval applies the new value and stamps the project’s current release revision.']),
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
      feature('enquiry', 'Enquiry queue', SearchIcon, ['Start with Enquiry items and Requests from Engineering, Design, or Stores. Confirm the technical description before contacting suppliers.', 'Use the project and source fields to separate normal project demand from In-Stock or Sold-As-Such demand.', 'A "Reserved from stock" badge means Stores has already committed inventory against that line — check with Stores before spending time sourcing it. The line still shows here because Reserve alone doesn\'t close it out; Stores only marks it In-Stock once they actually Issue the material.', 'A fresh BOM/SAS line does not reach this queue automatically anymore — Stores reviews it first (their Manual review step) and only sends it here by clicking Procure, which notifies you directly the moment it happens. You no longer need to check back speculatively for whether something new has landed.']),
      feature('quotes', 'Comparison and quotes', GitCompareIcon, ['Record each supplier quote with price, unit, payment terms, validity, and notes. Multiple quotes create a comparison trail rather than one unexplained price.', 'Do not delete a quote just because it lost; the history helps explain the final choice.']),
      feature('supplier', 'Supplier selection', Building2Icon, ['Select the supplier only after checking price, validity, terms, and technical fit. The selected quote becomes the basis for the draft PO.', 'If the requirement changes, update the BOM or request and leave a note rather than silently changing the supplier decision.']),
      feature('po', 'Purchase Orders', FileTextIcon, ['Review draft PO lines, issue the PO when the commercial details are correct, and generate the PDF for the supplier.', 'A PO issue moves the item into the next operational stage. Treat unissue/void actions as controlled corrections, not casual edits.']),
      feature('status', 'Status and delivery', TruckIcon, ['Use the status view to follow Enquiry, Comparison, Ordered, Transit, Received, Cancelled, and In-Stock. The summary also considers quote and supplier signals when the editable status cell is behind.', 'Keep PR/PO references readable because Stores and Production use them downstream.']),
      feature('purchaseReturns', 'Purchase Returns', Undo2Icon, ['Use the Returns tab to raise a return against an issued PO — wrong spec, damage, over-supply — and track it through inspection to a stock action and debit note.']),
      feature('requests', 'New-item requests', ClipboardListIcon, ['Requests land directly in the Enquiry flow. Accept the requirement by sourcing it, not by creating a second manual record.', 'Ask the requesting team for missing technical information through a task so the request remains traceable.']),
      {
        key: 'suppliers', label: 'Suppliers', icon: Building2Icon, group: true,
        body: ['Suppliers has two parts. Roster is the plain contact list — add, edit, or deactivate a supplier, and see their quote history one at a time. Analysis is a read-only report over the same quotes and purchase orders, rolled up: a Dashboard overview, By Supplier (spend, win rate, activity), and By Item — the "Purchase Card," a price history across every supplier who has ever quoted a material. Nothing under Suppliers needs separate data entry — it all comes from what Enquiry and Purchase Orders already log.'],
        children: [
          feature('suppliers-roster', 'Roster', Building2Icon, [
            'Add a supplier with name, GST number, contact person, phone, and email — name is the only required field. Expand a row to edit those details or deactivate the supplier, and to see every quote logged against them, most recent first.',
            'A bulk import (Add supplier card) replaces the whole roster from the client\'s real party-master file — use it for a full refresh, not for adding one supplier.',
            'Deactivating a supplier removes them from this list and from the picker when logging a new quote, but does not touch their quote history — it stays visible in Analysis.',
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
        ['Enquiry', 'Automatic', 'Completes once every BOM item on the project has moved past Enquiry into Comparison or further — "all items must clear the stage," not just the first one.'],
        ['Comparison', 'Automatic', 'Completes once every item has moved past Comparison into Ordered or further.'],
        ['Ordered', 'Automatic', 'Completes once every item has moved past Ordered into Transit or further.'],
        ['Transit', 'Automatic', 'Completes once every item has reached a closed status — Received, Cancelled, or In-Stock.'],
        ['Procured', 'Automatic', 'Same trigger as Transit — every item closed. The two often complete together, since arriving is usually the same real-world event as being fully procured.'],
      ]),
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
      'You now get a notification whenever a new BOM lands — an import, a single item, or a purchase requisition line — so Open Requests shouldn\'t need a blind daily check anymore.',
      'Operations has a Stores pipeline diagram now (the same kind of glance Procurement, Sales, and Design already have) — SAS/Trade, BOM Released, and Build Stock as the three sources feeding in, then Requests → Stores Review → Reserved → In-Stock, with Received (via Procurement) as the one outcome from Procurement\'s own pipeline Stores actually needs to see.',
    ],
    features: [
      feature('inventory', 'Inventory', BoxesIcon, ['Inventory shows on-hand quantity and the quantity reserved for active project requirements. Available stock is the usable balance after reservations.', 'Keep item names and units consistent so the same stock is not entered twice under slightly different names.', 'Set a minimum stock level per item (New item / edit) to get a "Low" flag once available stock drops to or below it. Click the low-stock count — on the card title or the "low stock" chip above it — to filter the table down to just those items; toggle it off the same way.']),
      feature('reserve', 'Reservations', ClipboardCheckIcon, ['Reserve stock against a BOM requirement when material is committed to a project. A reservation reduces available stock without pretending the material has already been issued.', 'Release a reservation when the requirement is cancelled or fulfilled another way — this fully frees the quantity back to available; there is no separate "reassign to a different project" action, releasing and reserving again is how you move committed stock to a different requirement.', 'A green "✓" badge under a request\'s description is a real match — both sides were picked from the item catalog (search when raising the request, or search in the New Item dialog) and share the same underlying item. A muted "≈" badge is the older, weaker signal: plain keyword overlap, not automated, when no catalog link exists on one or both sides. Trust the ✓; still eyeball the ≈ before reserving.', 'Reserving does not change the BOM line\'s purchase status by itself — only Issue does. Procurement sees a "Reserved from stock" badge on the line the moment you reserve, so they know not to duplicate the sourcing work, but the line still technically shows as open until you actually Issue it.', 'Reservations work identically whichever kind of demand you\'re reserving against — a normal project BOM line, a Stock request, or a SAS trade request all draw from the same available pool, no special cases.']),
      feature('review', 'Allocation Mode (Automatic / Stores Review)', ClipboardCheckIcon, [
        'Every material requirement — a released Project BOM line or a Sales SAS/trade request — follows the company\'s Allocation Mode. Stores is the inventory authority for both; it is not a mandatory approval step every requirement has to pass through just because Stores exists.',
        'Automatic (the default, recommended mode): the moment a requirement is created, the system checks it against an exact catalog match in Inventory. Full stock available → the whole line reserves itself and never reaches Procurement. Partial stock → the available part reserves itself and only the shortfall becomes a Procurement requirement. No matching stock → the full requirement goes straight to Procurement. You never have to click Reserve or Procure for a line Auto already resolved — an "Auto-reserved" badge (or "Remnant reserved" for plate/section stock, which was already automatic) marks it done, no action needed.',
        'Stores Review / Manual: every new BOM/SAS requirement instead waits in Stores Review — a "Stores Review" badge, invisible to Procurement until you act — and you choose Reserve from stock or Procure per line, exactly as before.',
        'Switch modes from the toggle at the top of Inventory — Stores-only, takes effect immediately for every new requirement from that point on (it does not retroactively re-decide requirements that already landed).',
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
      feature('receipt', 'GRN and receipt fields', PackageCheckIcon, ['On the BOM, record GRN reference, quantity received, pending quantity, and BQ-TC reference. These fields tell the rest of the system what physically arrived.', 'Use clear dates and quantities; do not write a total in a field that means pending balance.']),
      feature('remnant', 'Cutting & Remnant Matching', ScissorsIcon, [
        'A plate or section line in Inventory can hold real physical pieces instead of one plain quantity — each piece has its own dimensions, a computed weight, and a status (available, reserved, consumed, or scrap).',
        'The moment Design releases a matching BOM, a fitting piece reserves itself automatically. You will see it in Open Requests, not as something you did.',
      ], {
        checklist: [
          'Give a plate/section stock line a Category and MOC — New item, or edit an existing one — this is what matching checks against, the same as the BOM line\'s own Category/MOC.',
          'Add each physical piece under that line: click the layers icon next to it → Add piece → enter length/width/thickness for a plate (or length + kg per metre for a section) and density.',
          'Watch for the "Remnant reserved" badge in Open Requests — that line already found its match and needs nothing from you. A plain "Stores Review" line still needs your usual Reserve/Procure decision.',
          'If a matched line\'s requirement changes or gets cancelled, open its piece (layers icon) and click Release to free it back to available stock for the next match.',
        ],
      }),
      feature('sas', 'In-Stock and SAS material', BoxesIcon, ['Stock and Sold-As-Such items can follow the same sourcing and status flow without being attached to a normal project milestone chain.', 'Check the source and project context before issuing stock so the inventory movement remains auditable.', 'SAS is Sales-initiated, not Stores-initiated — Sales raises a trade request against their own Sale Order (from their Sale Orders tab) and it lands directly in your Requests queue. You no longer raise a SAS line yourself; only Build stock requests (source \'stock\') are still something Stores raises through Requests.', 'A SAS request goes through the exact same Allocation Mode as a Project BOM line — in Automatic mode it tries to reserve itself against stock the same way, only a shortfall reaches Procurement.']),
      feature('notifications', 'Notifications', BellIcon, [
        'You receive a notification the moment new material demand exists, from any of two sources: Engineering/Design importing a BOM workbook or adding a single BOM item, or any department raising a purchase requisition line — including Sales pushing a SAS material request against their own Sale Order.',
        'A SAS request from Sales reaches you the same way any new demand does: same Requests queue, same notification, no separate inbox to check and no need for Sales to message you separately.',
        'You also receive a notification the moment Procurement marks a BOM line Received, so you know material has actually arrived for a project (named by project number), landed as stock, or been received against a SAS trade request, without opening the BOM yourself to check.',
        'You receive a notification if a reservation gets released on a line that\'s still in Stores Review (see Manual review) — that line needs a fresh Reserve/Procure decision, and this is how you find out instead of it quietly sitting unresolved in Open Requests.',
        'This is the same bell every internal department uses, top right of the app. It is automatic for everyone with Stores access; nothing here is a toggle you turn on or off.',
      ], {
        value: 'Before this, Open Requests only told you what had already landed if you thought to check it, and a Received line was invisible until you happened to look. The notification exists so both a fresh requirement and material actually arriving reach you the moment either happens.',
        outcome: 'Every new demand — a BOM import, a single item, a purchase requisition line — and every Received line reaches Stores through one bell, with enough context (who raised it, which project, how many lines) to act without opening the BOM to check.',
        checklist: [
          'Treat the bell as the trigger to open Requests, not a substitute for actually reserving or issuing material.',
          'A SAS notification from Sales needs the same judgment as any other new requirement — check the description and quantity are specific enough before reserving.',
          'A "Procured" notification is your cue to check whether Stores already reserved something against that same line before — reconcile it rather than treating the arrival as automatically new demand.',
          'Do not wait for a notification for material that\'s clearly already overdue on a project you can see in the BOM — the bell covers new demand and new arrivals, not a daily sweep.',
        ],
        watchOut: 'The notification tells you demand exists or material arrived; it does not tell you whether stock is available or already reserved. Still check Inventory (or the possible-match badge) before promising anything back to the requester.',
      }),
      feature('issues', 'Material issued to WIP', PackageCheckIcon, ['Log material leaving Stores for the shop floor — pick the project, the BOM item, and the quantity. This is a separate action from Reserve→Issue: it does not touch on-hand or purchase status, it is purely a record of what physically went to WIP and when.', 'Production can log the same event from their own BOM view — either side recording it is fine, there is no duplicate-entry conflict since each is just an append-only log row, not a status change.']),
      feature('reorder', 'Reorder suggestions', AlertTriangleIcon, [
        'Every item at or below its minimum stock level (the same "Low" flag Inventory already shows) appears here with a suggested replenishment quantity — minimum minus available, editable before you commit.',
        'Create request turns a suggestion into a real Build stock request through the same flow Inventory\'s own stock-request path already uses — it lands in Open Requests as an ordinary Enquiry line, same as if you\'d raised it by hand.',
        'Nothing is created automatically. A suggestion stays a suggestion — visible, editable, ignorable — until you click Create request; and once you do, that item drops off this list until it needs reordering again.',
      ]),
      feature('gir', 'Gate Inward Receipts (GIR)', LogInIcon, [
        'Log every vehicle that enters the gate with material: vehicle number, supplier, driver, a material reference (PO/DC/BOM), and the two security checks (seal intact, documents verified) plus any remarks.',
        'A GIR is the gate-entry record, not the GRN — it exists independently of whether the material has been formally received yet. Attach the GRN reference and close the GIR once receipt is confirmed.',
        'This is a standalone security-desk log, not part of the reserve/available inventory model — creating a GIR never touches on-hand stock by itself.',
      ]),
      feature('gatepass', 'Gate Passes', FileOutputIcon, [
        'Raise a Returnable or Non-returnable gate pass before material or tooling leaves the gate — party/destination, responsible person, purpose, and an item list. A returnable pass also takes an expected return date; a non-returnable one does not.',
        'Approve, then Issue — a pass only leaves draft once someone with approval authority signs off. Cancel is available before issue.',
        'Once issued, tick each item off as it actually comes back — the pass itself flips to Returned automatically the moment every item on it is ticked, and back to Issued if you un-tick one by mistake.',
        'A returnable pass still out past its expected return date shows an Overdue badge — computed live, not something you have to check for; it clears the moment the pass is fully returned.',
      ]),
      feature('tasks', 'Tasks and handoffs', ListChecksIcon, ['Use Tasks for a missing document, a receipt question, or a delivery follow-up. Close the task when the physical or documentary action is complete.', 'Operations now shows Outgoing and Incoming Incidents for Stores, split by direction — same pattern Procurement already has. Raising one from either card sends a real notification to the other department immediately; there is nothing extra to do beyond filling in the Raise dialog.']),
    ],
    howTo: [
      { title: 'Receive material', body: 'Match the delivered material to the PO/BOM, record GRN reference and date, enter quantity received, and update the pending balance.' },
      { title: 'Reserve stock', body: 'Find the project requirement, choose the inventory item, enter the quantity, and confirm the reservation. Check available balance before promising stock.' },
      { title: 'Check what Automatic mode already did', body: 'In Automatic mode, before reserving anything by hand, check Open Requests for an "Auto-reserved" or "Remnant reserved" badge — that line already resolved itself and needs nothing from you. Only lines still showing "Stores Review", or genuinely unmatched lines Procurement is now sourcing, are real candidates for a manual Reserve.' },
      { title: 'Issue material', body: 'From Active reservations, click Issue once material actually leaves Stores for a reserved requirement — it decrements on-hand and marks that BOM line In-Stock. For material that arrived the normal way (not via a stock reservation) and is now physically leaving for the shop floor, use Material issued to WIP instead — pick the project and BOM item and log the quantity.' },
      { title: 'Handle a mismatch', body: 'Do not force a receipt into the wrong line. Raise a task to Procurement or Engineering with the PO, material description, and actual quantity.' },
      { title: 'Close the loop', body: 'Make sure the BOM receipt fields, inventory quantity, and reservation state agree before closing the Stores task.' },
      { title: 'Act on a reorder suggestion', body: 'Open Reorder Suggestions, check the suggested quantity against what you actually want to hold, adjust it if needed, and click Create request. Reserve from stock first if a request in Open Requests could be filled from what you already have — Reorder Suggestions is for topping up depleted stock, not a substitute for reserving.' },
      { title: 'Log a Gate Inward Receipt', body: 'The moment a vehicle enters with material, log a GIR: vehicle, supplier, driver, a material reference, and the two security checks. Enter at least a vehicle number or supplier — a blank GIR is not a real record.' },
      { title: 'Close a GIR', body: 'Once the material is actually received (via Procurement\'s GRN or your own confirmation), enter the GRN reference on the GIR row and click Close. Close is disabled until a GRN reference exists — a closed GIR always means the receipt is real, not just that the gate visit is over.' },
      { title: 'Issue and close out a Gate Pass', body: 'Raise the pass (Returnable or Non-returnable), get it Approved, then Issue it the moment material actually leaves. For a returnable pass, tick each item off as it comes back — the pass flips to Returned on its own once every item is ticked. An overdue returnable pass shows a badge automatically; there is nothing else to check for it.' },
    ],
  },
  Production: {
    title: 'Production', icon: HardHatIcon,
    intro: [
      'Production plans and records shop-floor execution against the real milestone chain used on the shop floor — Marking/Cutting through Drilling, Shell Welding, Site Marking, the FURA-B/RC/AR and Box-Up welds, Tubes & Stay Rods, Pad Plates, Smoke Box, Refractory, and Painting — plus Hydro Test, which moved here from QC because Production is who actually runs it day to day.',
      'Job Card is now your main tab, and it opens on the board by default because that is what gets touched most during the day. Work Orders, BOM, Forecast, Daily Sheet, and Workers Roster sit underneath it as sub-tabs — the old separate Tasks and Home tabs are gone because they showed the same calendar Home already shows everyone.',
    ],
    introFlow: {
      heading: 'How a Work Order (or a one-off card) becomes a completed milestone',
      subheading: 'Two ways in, one shared execution path.',
      stages: [
        {
          boxes: [
            { title: 'Work Order', body: 'Against a customer order (linked project + BOM) or against stock — the production order for a whole batch.' },
            { title: 'Job Card (ad hoc)', body: 'A one-off, created directly from the board — skips straight to Job Card execution below.' },
          ],
          arrowNote: 'The Work Order path continues below; an ad hoc card already is a Job Card.',
        },
        {
          boxes: [{ title: 'Process Route Card', body: 'One row per production step — operation, workstation, and (optionally) a real milestone.' }],
          arrowNote: 'Release the Work Order, then Generate Job Cards.',
        },
        {
          boxes: [{ title: 'Job Cards generated', body: 'One Job Card per route step, created in a single action — already linked to the right milestone.' }],
          arrowNote: 'Both paths now have real Job Cards to work.',
        },
        {
          boxes: [{ title: 'Job Card execution', body: 'Hours, consumables, and quantity done/rejected are logged here, on every card, from either path.' }],
          arrowNote: 'Once every card against a milestone is Done —',
        },
        {
          boxes: [{ title: 'Milestone completes automatically', body: 'No manual close needed for these — and Forecast / Work Order Costing read straight off this same data.' }],
        },
      ],
    },
    features: [
      feature('jobcards', 'Job Card board', HardHatIcon, ['Create a card against a real project milestone — the picker is Project then Milestone, not a typed description — and it carries an operation, workstation, and planned quantity if you know them yet.', 'Click a card to log hours against a named worker (filtered to their trade), add consumables like rods or gas, update planned/done/rejected quantity, pause and resume, and see the labor cost run as hours are logged.', 'Mark a card Outside for subcontracted work or Site for work done at the customer’s location instead of the shop — both show as a badge on the card so they are never mistaken for ordinary shop-floor work.', 'A failed test or a rejected quantity does not need a new form from scratch — Create rework card on the original card spins up a linked pending card against the same milestone.']),
      feature('workorders', 'Work Orders', ClipboardIcon, [
        'A Work Order is the production-control record that sits above Job Cards — either Against a customer order (linked to a Project/Sale Order and its released BOM) or Against stock (a replenishment run with no customer project).',
        'Build its Process Route Card first — the operation sequence, work centre, planned time, and quality checkpoints, each step optionally mapped to a real Production milestone so the existing milestone automation still fires.',
        'Add its material requirements — pull straight from the project BOM when the Work Order is against an order (issued quantity then reads live off Stores\' own material-issue log, nothing to keep in sync by hand), or add items directly with a manual issue log for a stock Work Order.',
        'Release it, then Generate Job Cards to spawn the real execution cards for every route step in one action instead of creating them by hand. Progress, delays, and rework roll up automatically from those linked cards.',
        'Once released, quantity/dates/product description can only move through a Change Note — a logged reason plus the old and new value — never a silent edit to the baseline.',
        'Load Costing on a Work Order for planned vs. actual material and labor; outside/subcontracted job cards are listed separately since this app has no vendor cost field for job-work.',
      ]),
      feature('forecast', 'Forecast', TrendingUpIcon, ['Upcoming Work Orders, workstation load, and outstanding material demand for the next 30 days — built from real released/in-progress Work Orders, their route cards, and their material lines, not a prediction model.', 'A workstation shows Overloaded once its open route-card time exceeds a flat single-shift assumption for the horizon — a signal to re-route or add a shift, not a hard limit.']),
      feature('bom', 'BOM, fabrication progress, and material issue', ClipboardListIcon, ['Pick a project to see its Master BOM, scoped to the fields Production owns (issued/received references) — the same table Engineering, Procurement, and Stores see, just field-scoped to what you are allowed to change.', 'The fabrication progress bars on this tab come directly from Job Card completion per milestone, so they only move when real cards are actually being closed out.', 'Issue material against a BOM line here when it leaves Stores for the shop floor — Production can record this now, the same authority you already had over issued/received references, just structured instead of free text.']),
      feature('remnant', 'Cutting & Remnant Matching', ScissorsIcon, [
        'Every plate or section BOM line shows in a "Cutting & remnant" list on the BOM tab. A "Reserved — ready to cut" badge means the system already found a matching piece in Stores for you.',
        'You only ever declare what you actually cut — how much was used and what usable offcut you kept. Weight, scrap, and the stock update are all computed for you.',
      ], {
        checklist: [
          'Open Job Card → BOM, pick the project, and find the "Cutting & remnant" list — every plate/section line shows here, whether or not it was matched.',
          'A "Reserved — ready to cut" badge means a piece is already waiting — click Cut and the source piece plus its exact required size are pre-filled for you.',
          'No badge just means pick a source piece yourself — click Cut, then Find stock, choose the stock line, then the piece.',
          'Confirm the pre-filled Used dimensions (or adjust to what was actually cut), and add a Remnant row for any usable offcut you are keeping — weight for both updates live as you type.',
          'Click Cut. The remnant goes straight back into Stores as available, the leftover becomes scrap automatically, and you never calculate a weight by hand.',
        ],
      }),
      feature('milestones', 'Production milestones', RouteIcon, ['Start a milestone when work really begins and close it only when the deliverable is actually complete; closing late asks for a reason so the project history explains the delay.', 'Use Stages under a milestone for repeatable checklist steps instead of inventing a new milestone for every variation.']),
      feature('tests', 'Hydro Test', FlaskConicalIcon, ['Hydro Test now belongs to Production end to end — you own the milestone and the test record itself (result, reference number, inspector, tested-on date), which you did not before.', 'Every other test type — radiography/NDE, material test certificates, freeform — stays QC’s; this tab only ever shows and creates Hydro Test records.']),
      milestoneTrackerFeature([
        ['Marking/Cutting through Painting (11 milestones)', 'Automatic', 'Each one completes once every job card raised against it on the Job Card board reaches Done — no card raised yet means the milestone stays open, not "trivially done."'],
        ['Hydro Test', 'Automatic', 'Completes once a Hydro Test record for the project is logged with a Pass result.'],
      ]),
      feature('employees', 'Workers Roster', UsersIcon, ['A Production worker is an HR employee record, not a separate roster — Add worker searches HR first, and if the person already exists you activate them onto Production instead of risking a second, slightly-misspelled entry for the same human.', 'Only create a new person when the search genuinely finds nobody. Trade is a controlled list (Welder, Fitter, Gas Cutter, Machinist, Grinder, Painter, Rigger, Helper), not free text, so job cards can filter workers by skill — designation stays HR’s field, not yours.', 'Deactivate rather than delete a worker who has left — their attendance and job-card history has to stay readable.']),
      feature('attendance', 'Daily Sheet', CalendarDaysIcon, ['Overview and Sheet live under one Daily Sheet tab now. Overview is the day’s headcount and attendance percentage; Sheet is where you actually mark present/half-day/absent and the project/milestone someone worked on.', 'This writes to the same attendance record HR reads from — there is no separate Production attendance system to keep in sync by hand anymore.']),
      feature('handoff', 'Department handoffs', MessageSquareIcon, ['Use tasks and notifications when Production needs a response from QC, Stores, Dispatch, or another department. A closed milestone should create a visible next action where configured.', 'Do not close a blocked job just to remove it from the screen; record the blocker and delay reason.']),
    ],
    // How To is split into one focused walkthrough per real action (like Notifications' Customer /
    // Departmental split above) instead of one long generic chain — pick the page for the thing you
    // are actually trying to do, not the department, and it stays a short, complete answer.
    howToGroups: [
      {
        key: 'howto-jobcard', label: 'Create a Job Card', icon: HardHatIcon,
        steps: [
          {
            title: 'Open the board', body: 'Open Job Card. It lands on the board by default, grouped Pending / In progress / Done — check what is already moving before creating anything new.',
            why: 'Starting from the board gives you the real current state of every project before you plan or create anything new.',
            verify: 'You know what is already Pending, In progress, and Done before deciding what to do next.',
          },
          {
            title: 'Create the card correctly', body: 'New job card, then pick the real Project and Milestone — not a typed guess. Add a workstation, planned quantity, and Outside/Site flags if either applies. Use this for a one-off, or anything a Work Order\'s route card didn\'t cover — for a whole new batch, set up a Work Order instead (see that guide).',
            why: 'A card tied to the real milestone is what keeps the fabrication percentage and milestone automation correct — a guessed one quietly breaks both.',
            verify: 'Required fields are complete and the milestone/project genuinely matches the work.',
          },
        ],
      },
      {
        key: 'howto-workorder', label: 'Set up a Work Order', icon: ClipboardIcon,
        steps: [
          {
            title: 'Choose the mode and build the route', body: 'Open Work Orders → New Work Order. Choose Against a customer order (pick the project) or Against stock (type the product), set the planned quantity and dates, then build the Process Route Card — every operation, workstation, and planned time — before you release it.',
            why: 'The Work Order is what authorizes the batch and carries its route and material plan — building it up front is what makes Generate Job Cards, Forecast, and Costing trustworthy later.',
            verify: 'Every route step has an operation and workstation, and (for an against-order Work Order) the material lines are pulled in from the BOM, before you release.',
          },
          {
            title: 'Release and generate its Job Cards', body: 'Release the Work Order, then click Generate Job Cards — this creates one card per route step automatically, already linked to the right milestone and workstation, instead of you creating each one by hand.',
            why: 'Generating from the route card is what keeps every card\'s milestone/workstation link correct and stops the same step from being created twice.',
            verify: 'One Job Card now exists per route step, each showing on the board under the right project and milestone.',
          },
        ],
      },
      {
        key: 'howto-log', label: 'Log work on a card', icon: Clock3Icon,
        steps: [
          {
            title: 'Do and record the work', body: 'As work happens, log hours against the actual worker doing it, add any consumables used, and keep planned/done/rejected quantity true to what is physically happening.',
            why: 'Recording the result as it happens is what the next department, and the Work Order\'s own costing, actually rely on — not a memory of it later.',
            verify: 'Hours, consumables, and quantity are saved in the record itself, not only remembered or messaged.',
          },
        ],
      },
      {
        key: 'howto-cut', label: 'Cut material for a Job Card', icon: ScissorsIcon,
        steps: [
          {
            title: 'Find the line and check for a reservation', body: 'Open Job Card → BOM, pick the project, and find the "Cutting & remnant" list — every plate/section line shows here. A "Reserved — ready to cut" badge means Stores already has a matching piece waiting for you; no badge just means you\'ll pick a source piece yourself.',
            why: 'A reserved piece is already the correct size for this line — skipping the check risks cutting from the wrong stock and losing a genuine match.',
            verify: 'You know whether this line has a reserved piece before you open Cut.',
          },
          {
            title: 'Cut and record what you kept', body: 'Click Cut — a reserved piece pre-fills the source and required size; otherwise use Find stock to choose the stock line and piece yourself. Confirm the Used dimensions (or adjust to what was actually cut), and add a Remnant row for any usable offcut you\'re keeping, then click Cut.',
            why: 'Declaring only what was used and kept is what lets the system compute weight, scrap, and the stock update for you — a hand-typed weight is exactly what this flow exists to avoid.',
            verify: 'The remnant shows back in Stores as available and the leftover became scrap automatically — you never calculated a weight by hand.',
          },
        ],
      },
      {
        key: 'howto-hydro', label: 'Record a Hydro Test', icon: FlaskConicalIcon,
        steps: [
          {
            title: 'Open the project\'s Production tab and log the result', body: 'On the project page, open the Production tab (filtered to Hydro Test only) and record the result, reference number, inspector, and tested-on date. This is the one test type Production owns end-to-end — every other test type stays QC\'s.',
            why: 'Hydro Test moved to Production because Production is who actually runs it day to day — logging it here, not asking QC, is what keeps the record honest.',
            verify: 'Result, reference, inspector, and date are all filled in before you save.',
          },
          {
            title: 'Handle a fail without losing the trail', body: 'A failing result has its own Create rework card button, pre-filled — use it instead of editing the original record. A passing result automatically closes the Hydro Test milestone for you.',
            why: 'Keeping the failed record as-is, with a linked rework card, is what preserves an honest quality history instead of quietly erasing a failure.',
            verify: 'A failed test has a linked rework card, and a passed test shows the Hydro Test milestone closed on its own.',
          },
        ],
      },
      {
        key: 'howto-milestone', label: 'Start and close a milestone', icon: RouteIcon,
        steps: [
          {
            title: 'Start it when work really begins', body: 'Open the milestone from the project page and mark it started once real work is actually underway — not in advance, and not as a formality.',
            why: 'An early start date makes the project timeline lie about when work actually began, which breaks every delay/on-time read built on it.',
            verify: 'The milestone\'s start date matches the day work genuinely began.',
          },
          {
            title: 'Close it honestly, with a reason if late', body: 'Close a milestone only when the deliverable is actually complete. Closing late asks for a reason, which goes into the project history — use Stages under a milestone for repeatable checklist steps instead of inventing a new milestone for every variation.',
            why: 'A late-close reason is what lets anyone reading the project later understand a real delay instead of guessing.',
            verify: 'The milestone is genuinely complete, and a late close has a real reason attached, not a placeholder.',
          },
        ],
      },
      {
        key: 'howto-exceptions', label: 'Handle exceptions', icon: WrenchIcon,
        steps: [
          {
            title: 'Pause, rework, or change the plan', body: 'Pause a card instead of leaving it looking active when work has genuinely stopped. If QC fails a Hydro Test or a quantity is rejected, use Create rework card rather than editing the original result away. If a Work Order\'s quantity, dates, or product changes mid-flight, use its Change Note instead of editing the field directly.',
            why: 'Exceptions handled honestly — pause, rework, Change Note — keep the record trustworthy instead of quietly rewriting what actually happened.',
            verify: 'Any paused card, rework card, or Change Note has a real, findable reason attached to it.',
          },
        ],
      },
      {
        key: 'howto-roster', label: 'Add a worker to the roster', icon: UsersIcon,
        steps: [
          {
            title: 'Search HR before creating anyone new', body: 'Add worker searches HR first — if the person already exists as an HR employee record, activate them onto Production instead of creating a second, slightly-misspelled entry for the same human. Only create a new person when the search genuinely finds nobody.',
            why: 'A Production worker is an HR employee record, not a separate roster — a duplicate entry splits one person\'s attendance and job-card history across two records.',
            verify: 'You searched HR first, and the person you added or activated has one single record, not a duplicate.',
          },
          {
            title: 'Set trade, and deactivate instead of delete', body: 'Trade is a controlled list (Welder, Fitter, Gas Cutter, Machinist, Grinder, Painter, Rigger, Helper), not free text, so job cards can filter workers by skill — designation stays HR\'s field, not yours. When someone leaves, deactivate rather than delete them.',
            why: 'Deleting a worker would break every job card and attendance record that already points at them — deactivating keeps that history readable.',
            verify: 'The worker\'s trade is set from the real list, and a departed worker is deactivated, not deleted.',
          },
        ],
      },
      {
        key: 'howto-attendance', label: 'Mark attendance', icon: CalendarDaysIcon,
        steps: [
          {
            title: 'Check Overview, then mark the Sheet', body: 'Daily Sheet has two views under one tab: Overview is the day\'s headcount and attendance percentage; Sheet is where you actually mark present/half-day/absent and the project/milestone each worker worked on.',
            why: 'Marking attendance against the real project/milestone is what makes the headcount numbers, and Production\'s own labor cost, mean something.',
            verify: 'Every worker present today has a status and a project/milestone recorded, not just a checkmark.',
          },
          {
            title: 'Trust it as the one real attendance record', body: 'This writes to the same attendance record HR reads from — there is no separate Production attendance system to keep in sync by hand.',
            why: 'A second, unsynced attendance record is exactly the kind of drift that makes payroll and HR distrust Production\'s numbers.',
            verify: 'You marked attendance once, here, and did not also track it anywhere else.',
          },
        ],
      },
      {
        key: 'howto-handoff', label: 'Raise a department handoff', icon: MessageSquareIcon,
        steps: [
          {
            title: 'Use a task or notification, not a side conversation', body: 'Use tasks and notifications when Production needs a response from QC, Stores, Dispatch, or another department. A closed milestone should create a visible next action where one is configured.',
            why: 'A handoff that only happened in conversation leaves no record another department, or you later, can point back to.',
            verify: 'The other department has a real task or notification, not just a message you sent them.',
          },
          {
            title: 'Never close a blocked job to hide it', body: 'Do not close a blocked job just to remove it from the screen — record the actual blocker and delay reason instead.',
            why: 'A quietly closed blocked job looks finished to everyone downstream, which is worse than an honestly open one.',
            verify: 'A blocked job stays open with a real blocker and reason recorded, not closed early.',
          },
        ],
      },
      {
        key: 'howto-close', label: 'Close the day', icon: BadgeCheckIcon,
        steps: [
          {
            title: 'Close the day', body: 'Mark attendance on the Daily Sheet while it is still fresh, close milestones only when actually complete with a real reason if late, check Forecast for any workstation running Overloaded, and raise a task for anything another department must still act on.',
            why: 'Closing the day with an honest status is what keeps dashboards, Forecast, and downstream departments aligned with what is actually happening on the shop floor.',
            verify: 'Attendance is marked, no milestone is closed early, and Forecast has been checked for anything about to go overloaded or late.',
          },
        ],
      },
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
      feature('statutory', 'Statutory documents', FileTextIcon, [
        'Use the statutory document editor for the supported form workflows — Form IV A for the standard CF/MF/OF/SF/SIB/PRS boiler folder, or Form III + Form III-H for a standalone Header/Desuperheater/Tank component shipped without a complete boiler (model HEADERS). Header data and part rows are kept together so the PDF reflects the saved record.',
        'Do not advance a document with missing required fields; the PDF gate is there to prevent incomplete evidence being treated as final.',
        'Linking a part to its BOM line (the small "Link to BOM item"/"Suggested" control under the part\'s size, or the dropdown when unlinked) unlocks certificate suggestions above the search box in the Link Certificate dialog — a ✓✓ badge means this material/maker pairing has been approved 3+ times before, ✓ means the material spec matches exactly, ≈ means only a partial text match. All three are one-click nudges, never automatic — a part with no BOM link, or one whose BOM line has no real material spec to compare against, shows no suggestion at all rather than a guess.',
      ]),
      feature('milestones', 'QC milestones', RouteIcon, ['Start and close QC milestones with actual dates. When work is late or failed, record the reason and create the follow-up task.', 'A QC result and a milestone are related but not identical: use the test record for the evidence and the milestone for project progress.']),
      feature('notifications', 'Notifications', BellIcon, [
        'You receive a notification once every BOM item on a project has cleared Procurement — the "Procured" milestone completing, the same automatic signal Procurement\'s own status queue relies on. The notification tells you the project is ready for QC to start preparing inspection records, before Production even starts fabricating.',
        'This is currently QC\'s only notification type. QC owns no milestones that another department hands off into or out of (Hydro Test, the one milestone that used to sit with QC, now belongs entirely to Production — see the Test records section), so there is no cross-department handoff traffic reaching QC the way there is for most other departments.',
        'This is the same bell every internal department uses, top right of the app. It is automatic for everyone with QC access; nothing here is a toggle you turn on or off.',
      ], {
        value: 'Before this existed, QC had no cross-department signal at all — the only way to know a project had reached a stage worth preparing for was to keep checking projects by hand. This gives QC the same early warning every other manufacturing department already had.',
        outcome: 'QC learns a project is materially ready to be worked the moment Procurement finishes clearing it, instead of discovering that only when Production or Dispatch is already asking for QC\'s sign-off.',
        checklist: [
          'Treat the notification as a planning signal, not a request for an immediate test — use it to line up references, certificates, and inspection records ahead of the actual fabrication work.',
          'Open the named project to confirm what was actually procured before assuming every line QC expects has arrived.',
        ],
        watchOut: 'This notification tracks Procurement clearing every BOM line — it does not mean material has physically arrived at Stores or that fabrication has started. Check the project\'s actual status before treating it as a cue to test anything.',
      }),
      feature('handoff', 'Release and sign-off', ShieldCheckIcon, ['Make the result and supporting references clear for Production, Dispatch, Management, and the customer-facing record. Keep rework visible instead of silently editing a passed record.']),
      feature('stageInspections', 'Incoming / Finished Goods / Subassembly Inspection', ClipboardCheckIcon, [
        'Incoming Inspection is auto-suggested (Pending) the moment a BOM item you\'re buying reaches Received — you don\'t have to notice the receipt yourself, just fill in the result. You can still add one by hand for anything the auto-suggestion misses.',
        'Finished Goods Inspection is tied to a Work Order. Pass it and flip "Dispatch eligible" once you\'re satisfied the completed goods are fit to ship — Dispatch\'s packing flow reads that flag.',
        'Subassembly Inspection is tied to a BOM assembly (Engineering tab → BOM Structure) — use it for an intermediate stage check before the sub-assembly moves on, not the finished product.',
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
        'Raise an NCR (Non-Conformance Report) for any defect — a failed test result, or a field-found problem with no test behind it yet. Both QC and Production can raise one; only the QC Head can disposition it.',
        'Disposition is one of four choices: Rework (only available when the NCR is against a job card — creates a new rework job card automatically), Repair (same, a lighter fix than a full rework), Scrap (only if the NCR is against a tracked stock piece — flips it to Scrap and rolls the inventory count down), or Use as-is (accept the non-conformance, no material action). Scrap and Use as-is both require written notes explaining the decision — the form will not submit without them.',
        'Close the NCR once its disposition is actually carried out — if it produced a rework job card, that card has to reach Done first; the Close action refuses otherwise.',
      ]),
      feature('holds', 'Hold Points', LockIcon, [
        'A Process Route Card step that names a QC checkpoint automatically becomes a hold point on every job card generated from it — Production cannot mark that card Done until QC releases it here.',
        'Release requires that any NCR raised against the card is already closed — an open NCR blocks the release, by design.',
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
    ],
    howTo: [
      { title: 'Create the inspection record', body: 'Open the project QC area, choose the test type, enter reference and inspector details, and leave the result Pending until the check is complete.' },
      { title: 'Record a result', body: 'Enter the tested date and result, then add notes that explain any failure, limitation, re-test, or acceptance condition.' },
      { title: 'Store evidence', body: 'Add or find the relevant Test Certificate or statutory document and check that the PDF uses the saved data.' },
      { title: 'Raise an NCR', body: 'On a failed test row (or directly from Production\'s job card), raise an NCR instead of silently reworking — it keeps the non-conformance on record until it\'s actually dispositioned and closed.' },
      { title: 'Close the QC handoff', body: 'Close the QC milestone only when the inspection and evidence are complete, then confirm the next department can find the references.' },
      { title: 'Clear a Work Order for dispatch', body: 'Once a Finished Goods Inspection passes, flip its "Dispatch eligible" flag so Dispatch can see the Work Order is cleared to pack.' },
      { title: 'Release a hold point', body: 'Once the checkpoint is actually verified and any NCR against the card is closed, release it from the Hold Points tab so Production can mark the card Done.' },
      { title: 'Keep calibration current', body: 'Check the Calibration tab regularly for items going Due soon or Expired, and Block anything pulled out of service.' },
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
      feature('reports', 'Reports', BarChart3Icon, [
        'Dispatch Register lists every dispatched shipment with its freight and e-way bill details. E-Way Bill Register narrows that to shipments carrying an e-way bill number. Freight Cost Summary groups freight spend by who paid it and by month. Pending vs Dispatched Aging is the flip side of the Register — shipments still sitting, by how long.',
        'Every report reads live off the same packing list data — there is nothing to enter separately for reporting.',
      ]),
      milestoneTrackerFeature([
        ['Packing', 'Automatic', 'Completes once a packing list for the project reaches Packed or Dispatched status — a Draft list doesn\'t count yet.'],
      ]),
    ],
    howTo: [
      { title: 'Create the list', body: 'Open Dispatch, generate a draft from the project BOM, and confirm that only the intended pending lines were included.' },
      { title: 'Pack physically', body: 'Fill box/package details, enter actual packed or scanned quantities, and check the physical count against the list.' },
      { title: 'Complete the header', body: 'Enter customer/address, invoice or DC, vehicle, contact, and dispatch-through details before changing the status.' },
      { title: 'Release the document', body: 'Move the list to Ready only after the contents and header are checked, then generate the PDF.' },
      { title: 'Close dispatch', body: 'After the vehicle leaves, move the list to Dispatched and keep the PDF with the customer/order record.' },
      { title: 'Check aging', body: 'Use Pending vs Dispatched Aging to spot lists sitting in Draft or Ready too long before they actually ship.' },
    ],
  },
  Installation: {
    title: 'Installation', icon: MapPinIcon,
    intro: [
      'Installation tracks the work that happens at the customer site after manufacturing and dispatch. The project record should show what is planned, what the site team completed, and what is still waiting on the customer or another department.',
      'Use Operations for your open site work, Projects for the order record, Tasks for site-specific follow-ups, and the Installation tab (Service Calls, Service Contracts, Reports) for post-handover customer service.',
    ],
    features: [
      feature('milestones', 'Site milestones', RouteIcon, ['Start and close installation, commissioning, and site milestones with actual dates. Use planned dates to make the expected visit visible early.', 'If a date moves, record the reason so the customer-facing progress story remains honest.']),
      feature('tasks', 'Site tasks', ListChecksIcon, ['Use tasks for access arrangements, foundation readiness, customer documents, travel, tools, and punch-list items.', 'Assign each task to a person or receiving department and include the project in the task.']),
      feature('handoff', 'Handoffs', MessageSquareIcon, ['Use cross-department tasks when Installation needs Dispatch, QC, Production, or Management to act. Close the task only after the receiving action is confirmed.', 'Keep customer commitments in the project record, not only in a private message.', 'Marking Commissioning & Handover complete is different from every other milestone close: there is no next department in the chain for it to hand off to, so it notifies Sales and every PM-tier account directly instead — the project is now fully done, not just past Installation.']),
      feature('progress', 'Customer progress', FolderKanbanIcon, ['The customer portal reads project progress from milestones. Accurate actual dates and delay reasons improve the customer view without extra reporting work.']),
      feature('service-calls', 'Service Calls', HeadsetIcon, [
        'Log a customer complaint or service call against the project (its "covered equipment"), with priority and an optional SLA target in hours.',
        'Manage a call to move it through Open → Assigned → In Progress → Resolved → Closed, assign a technician, and record diagnosis, resolution, and closure evidence.',
        'Visit history is a separate log on the call — add one row per site visit (technician, date, notes) independent of the call\'s own status.',
      ]),
      feature('service-contracts', 'Service Contracts', FileSignatureIcon, [
        'Create a contract against a project — customer, coverage window, visit frequency, and entitlement (what\'s actually covered).',
        'Renew a contract to create a new contract row linked to the old one, which moves to Renewed; the old record is never overwritten. Cancel is available on an active contract.',
        'A contract within 30 days of its end date is flagged "Expiring soon" on the list.',
      ]),
      feature('service-reports', 'Reports', BarChart3Icon, [
        'Read-only reports covering installation milestones and delays, commissioning completion, service call aging and SLA compliance, technician performance, and contract renewals.',
        'Every number is computed live off the same Service Calls, Service Contracts, and milestone data — there is nothing to enter separately.',
      ]),
      milestoneTrackerFeature([
        ['Site Installation', 'Explicit action', 'Click "Mark complete" on the project\'s Installation tab — nothing else in the app logs a site visit, so there\'s no data signal to auto-detect this from.'],
        ['Commissioning & Handover', 'Explicit action', 'Same "Mark complete" action, once site installation is done.'],
      ]),
    ],
    howTo: [
      { title: 'Prepare the visit', body: 'Open the project, review the next site milestone, and create tasks for access, material, travel, tools, and customer readiness.' },
      { title: 'Start site work', body: 'Start the milestone when the team begins. Add a note or task for anything discovered on site that needs follow-up.' },
      { title: 'Manage a blocker', body: 'Record the delay reason and raise the task to the right department. Do not close the milestone while the blocker is unresolved.' },
      { title: 'Complete commissioning', body: 'Enter actual end date, close the milestone, and ensure any punch-list task is either completed or clearly assigned.' },
      { title: 'Confirm the customer view', body: 'Check that the project progress and estimated dates now tell the same story as the site record.' },
      { title: 'Handle a post-handover complaint', body: 'Log a Service Call against the project, set priority and an SLA target, then Manage it through assignment, diagnosis, and resolution as work happens.' },
      { title: 'Track a maintenance contract', body: 'Create a Service Contract against the project with its coverage window and entitlement; renew it before it expires rather than letting it lapse.' },
    ],
  },
  Sales: {
    title: 'Sales', icon: TrendingUpIcon,
    intro: ['Sales manages the commercial journey from qualified enquiry to confirmed Sale Order. The CRM keeps customers, contacts, quotations, and orders connected so the factory receives a clean handoff.', 'Marketing shares Leads, Campaigns, Pipeline, Tasks, and Reports. Sales additionally owns Customers, Quotations, and Sale Orders.'],
    features: [
      feature('enquiry', 'Enquiry', InboxIcon, [
        'Enquiry is the same Leads list, pre-filtered to status "new" — a raw, not-yet-worked enquiry is exactly what that status already means (the 24h SLA flag already treats it that way). It is not a second record to fill in.',
        'Use it as your daily start-here queue; switch to the full Leads tab when you need to see contacted/qualified/converted/lost too.',
      ]),
      feature('leads', 'Leads', UserPlusIcon, ['Capture the person/company, contact details, source, territory, and industry. Move the status as the conversation progresses.', 'Convert a qualified lead to create a Customer and Opportunity together; this prevents duplicate typing.']),
      feature('pipeline', 'Pipeline', TrendingUpIcon, ['Move opportunities through the configured stages. Keep value, probability, expected close, next contact date, and lost reason current.', 'An opportunity is the active deal; a lead is still an enquiry. Do not leave won work sitting as an open opportunity.', 'Creating a Quotation linked to an opportunity still sitting in Lead or Qualified moves it to Quoted automatically — one-way, so it never pulls a Won or Lost opportunity backward. It does not replace moving a card by hand for every other stage change; it only ever pushes Lead/Qualified forward the moment real commercial evidence (a quotation) exists.']),
      feature('customers', 'Customers and contacts', Building2Icon, ['Keep the commercial party, people, and addresses in one place. Reuse these records in quotations and orders instead of creating near-duplicates.']),
      feature('quotations', 'Quotations', FileTextIcon, ['Build the proposal with real line items, rates, taxes/terms as applicable, then generate the PDF. Convert an accepted quotation to a Sale Order.', 'Search the item catalog while typing a line\'s description — picking a match fills in the UoM and, if a Price List entry exists for that item (and this customer, or the default rate), the rate too. You can always overwrite the rate by hand; nothing is locked.']),
      feature('price-lists', 'Price Lists', TagIcon, [
        'Set a rate per item, either for one specific customer or as the default open to everyone — Sales → Price Lists → New Price, searched from the same item catalog Quotations uses.',
        'Add a valid-from/valid-until window when a rate is time-bound; leave either blank for an open-ended rate. An expired entry stays visible in the list (flagged "Expired") but is skipped by the quotation auto-fill.',
        'A customer-specific price always wins over the default rate for the same item when both exist.',
      ], {
        value: 'A rate re-typed from memory on every quotation drifts — the same item ends up billed differently to the same customer across two proposals with no record of which was right. A published rate list is the one place the real, current price for an item actually lives.',
        outcome: 'Building a quotation for a repeat item is a lookup, not a guess — the rate is right there the moment the item is picked, still visible for you to confirm or override before saving.',
        checklist: ['Set the default (all-customers) rate first; add a customer-specific override only where a real negotiated rate differs from it.', 'Refresh an expiring rate before it lapses — Quotations silently falls back to a blank/manual rate once it does, not the old number.'],
        watchOut: 'This groups on the exact catalog item, not a typed description — a quotation line typed free-text without picking from the catalog never matches a price list entry, even if the words look the same.',
      }),
      feature('sale-orders', 'Sale Orders', ShoppingCartIcon, ['The Sale Order is the confirmed commercial order. Linking it to a Project creates the Design/Engineering Scope of Supply handoff.', 'Convert to Project on a Sale Order creates the Project directly — no need to ask a PM out of band. Once a Project exists for that order, the button is gone; you\'re looking at the right one if it isn\'t there.', 'Request from Stores on a Sale Order raises a trade (SAS) request straight to Stores\' queue — describe the item and quantity, and Stores sees it immediately.']),
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
        'You send a notification to Stores every time you use Request from Stores on a Sale Order. It lands in Stores\' Requests queue immediately, the same way one they raise themselves would — there is no separate inbox and no delay.',
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
      feature('tasks', 'Tasks, notes, and calls', PhoneIcon, ['Log the outcome and next step after every meaningful contact. Add tasks with due dates instead of relying on memory.']),
      feature('reports', 'Reports', BarChart3Icon, ['Use Sales Pipeline, By Department, Agent Performance, Lead Funnel, Source, and Campaign reports to keep the funnel honest. Reports can be printed to PDF from the browser.']),
      feature('agent-performance', 'Agent Performance', UserRoundIcon, [
        'Reports → Agent Performance groups every lead, task, and opportunity by who it\'s assigned to (or, for opportunities, who created it — see the watch-out below) — no separate data entry, it reads what Leads/Tasks/Pipeline already record.',
        'Leads assigned, conversion rate, and follow-up completion are real per-agent numbers straight off `assigned_to`. Won value and top lost reason are not — Opportunities has no per-agent owner field yet, so these are attributed by whoever created the opportunity record instead, labeled with an asterisk in the table.',
        'Average response time is a proxy too: the gap between a lead being created and the first note logged against it, not a real tracked first-contact timestamp. Treat it as a rough signal, not an SLA measurement.',
      ], {
        value: 'Every other report here looks at the funnel as a whole. This is the one that answers "who is actually doing the work" — without it, a slow or overloaded agent is invisible until someone happens to notice.',
        outcome: 'You can see, per agent, how much is on their plate and how it\'s converting — enough to rebalance assignment or follow up on a stalled patch, without pulling each agent\'s leads one at a time.',
        checklist: ['Read Won value and Top lost reason as "who logged this," not "whose deal this really was," until Opportunities gets a real owner field.', 'Use response time to spot a pattern across many leads, not to judge one.'],
        watchOut: 'An agent with zero leads/tasks/opportunities assigned to their username simply doesn\'t appear in the table — this is not a filtered-out or hidden row, there is nothing to show yet.',
      }),
    ],
    howTo: [
      { section: 'Sale Order', title: 'Capture an enquiry', body: 'Create a Lead with the best contact details and source you have. Add a follow-up task immediately.' },
      { section: 'Sale Order', title: 'Qualify it', body: 'Log calls/notes, confirm requirement and timing, and move the lead status to qualified when it is a real opportunity.' },
      { section: 'Sale Order', title: 'Create the commercial record', body: 'Convert the lead, work the Opportunity, create a Quotation with real line items, and generate the PDF.' },
      { section: 'Sale Order', title: 'Confirm the order', body: 'Convert the accepted quotation to a Sale Order and check customer/address details before linking it to a Project.' },
      { section: 'Sale Order', title: 'Hand off cleanly', body: 'Open Sale Orders and use Convert to Project on the order, or link it to a Project already created, then add any commercial note or task that Design/Engineering must know.' },
      {
        section: 'SAS material request', title: 'Request material for a SO', body: 'Open Sale Orders, use Request from Stores on the order, and describe the item and quantity. This goes to Stores as a trade (SAS) request against that Sale Order.',
        why: 'Material sometimes needs to move before a Project exists — a SAS request lets Stores act on it without waiting for the full handoff.',
        verify: 'The item description and quantity are specific enough for Stores to act on without asking you to clarify.',
      },
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
  Accounts: {
    title: 'Accounts', icon: LandmarkIcon,
    intro: [
      'Accounts owns the full books for both legal entities (Shanti Boilers & Pressure Vessels (P) Ltd and Shanti Techno Fab) — chart of accounts, journal entries, GST compliance, and the derived Trial Balance/P&L/Balance Sheet. Shanti Ops is the system of record here, not a document trail feeding an external accounting package; Tally, if ever connected, would be an optional sync target reading from this ledger, not the other way round.',
      'Most of the ledger fills itself in: issuing a Sales Invoice, approving a Vendor Bill, raising a Credit/Debit Note, or marking a Salary Slip paid each post their own journal entry automatically. Your day-to-day work is mostly settlement (receipts/payments), GST compliance (returns and reconciliation), and the exceptions nothing else already covers (Manual Journal Entry, bank reconciliation).',
      'Operations has a glance view now (the same kind of pipeline diagram Procurement, Sales, Design, and Stores already have) — but Accounts isn\'t one pipeline, so it shows three independent spines instead: Purchase → Pay (Bill Draft → Approved → Paid, with Debit notes off to the side), Order → Cash (Invoice Draft → Issued → Paid, with Credit notes off to the side), and Period Close (JE Draft → Posted → Reconciled, with GST returns filed off to the side). All three read live off the ledger; there is nothing to enter here.',
    ],
    features: [
      feature('settings', 'Company Settings', Building2Icon, ['One row per legal entity — GSTIN, PAN, registered address, state code, and invoice series prefix. Every document number (invoice, credit note, receipt…) and every GST split (CGST+SGST vs IGST) is computed from this record, so keep it accurate before relying on anything downstream.']),
      feature('rates', 'GST & TDS Rates', PercentIcon, ['HSN → GST rate and TDS section → rate/threshold masters, effective-dated like Payroll’s own statutory rates. A rate with no row here falls back to whatever flat percentage the originating document typed by hand — add the real rate before trusting an automatic split.']),
      feature('ledger', 'Chart of Accounts & General Ledger', LayersIcon, ['Each company’s chart is seeded with the accounts every auto-posting trigger needs (AR, AP, GST Input/Output, Raw Material Inventory, Salary Expense, and the rest) — add an account only when a real new use needs one, not speculatively.', 'Trial Balance, Profit & Loss, and Balance Sheet are read-only rollups off the ledger, not separate records — if they look wrong, the fix is always in what posted to the ledger, never in the report itself.']),
      feature('journal', 'Manual Journal Entry', FileEditIcon, [
        'Use this only for what no document already covers — every Sales Invoice, Vendor Bill, Credit/Debit Note, Salary Slip, receipt, payment, and Material Issue posts itself. A Manual Journal Entry is for a real adjustment nothing else models.',
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
      feature('settlement', 'AR / AP settlement', ReceiptIcon, ['Record a customer receipt against an issued Sales Invoice or a vendor payment against an approved Vendor Bill — pick the real document from the list, not a free-text reference. Each one posts Bank & Cash against Accounts Receivable/Payable and moves the parent document to Paid once it is genuinely fully settled.', 'A receipt or payment cannot exceed the real balance still due — the amount is checked against everything already recorded against that document, not just typed and trusted.'], {
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
        watchOut: 'GSTR-2B is evidence to reconcile against, not a replacement purchase register — Shanti Ops’ own Vendor Bills stay the real accounting record even after a GSTR-2B line is matched and accepted.',
      }),
      feature('bank-rec', 'Bank Reconciliation', GitCompareIcon, ['Every posting against the Bank & Cash account — salary payouts, receipts, payments, any manual entry that touched it — shows here for you to tick off against the real bank statement, one line at a time.'], {
        outcome: 'The reconciled balance genuinely matches what has cleared on the real bank statement, and the unreconciled list is a true, current exception queue — not a guess.',
        checklist: [
          'Pull up the real bank statement for the period alongside this list before ticking anything off.',
          'Match each ledger line to the statement one at a time; leave anything that hasn’t actually cleared unticked.',
          'Treat a persistently unreconciled line as a real exception to chase, not something to tick off anyway to clear the list.',
        ],
        watchOut: 'This is a manual tick-off against the ledger, not a bank-statement import — there is no file upload here and no separate bank-account master yet. Match each line by hand against the real statement.',
      }),
    ],
    howTo: [
      { title: 'Confirm the company and period first', body: 'Pick the legal entity (Shanti Boilers or Shanti Techno Fab) and the period before doing anything else — invoice numbering, GST return periods, and every report are scoped to that pair, and picking the wrong one is the easiest way to post or read the wrong company’s books.' },
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
export const DEPARTMENT_HELP_ORDER = ['Design', 'Engineering', 'Procurement', 'Stores', 'Production', 'QC', 'Dispatch', 'Installation', 'Sales', 'Marketing', 'HR', 'Accounts'];
