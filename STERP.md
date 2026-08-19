I audited the STERP list against the current Shanti Ops codebase and counted equivalent functionality even when the names differ.

Strict count: 101 named capabilities.

- 27 already present
- 13 partially present or covered by an adjacent workflow
- 61 currently missing

The finance, GST, statutory payroll, and accounting items are not accidental gaps. They were intentionally deferred in the current product decision toward ERPNext/accounting integration.

## Already covered

Examples of equivalent features already built:

- Sales Leads → Leads, Opportunities, Pipeline
- Sales Quotation → Quotations with PDF generation
- Sales Order → Sale Orders
- Purchase Enquiry → Procurement Enquiry
- Purchase Quotation → Supplier Quotes and comparison
- Purchase Order → Purchase Orders and PDFs
- Indent Processing → Requests, Procurement Requests, Purchase Requisitions
- GRN → BOM receipt/GRN fields
- Material Issue → Inventory issue workflow
- Stock Status → Inventory, reservations, available quantity
- BOM → Master BOM
- Erection & Commissioning → Installation milestones
- Employee Management and Employee Data Bank → Employees/HR
- Loan Management → Employee Loans
- Attendance and Leave → HR workflows
- Approvals → Approvals workspace
- Task Management → Tasks and cross-department handoffs
- Customers and Contacts → CRM
- Business Summary and Graphs → Executive/CRM reports

The web application is responsive, but it does not currently have a separate native mobile app.

## Partial or adjacent features

These exist in some form but do not yet match the full STERP capability:

- Sales Enquiry  
  Covered through Leads and Pipeline, but there is no distinct enquiry intake/status workflow.

- Sales Costing  
  Quotation rates exist, but there is no dedicated costing/margin calculation comparing selling price against BOM/procurement/production cost.

- Sales Agent Performance  
  Assignment rules and reports exist, but there is no dedicated agent performance dashboard with conversion, response time, value, and target metrics.

- GIR  
  Receiving and GRN data exist, but there is no formal Gate Inward Receipt document and gate-entry workflow.

- Incoming and In-Process QC  
  QC test records and milestones exist, but inspection is not yet deeply linked to PO receipt, operation, route card, or work order stages.

- Service Reports  
  General CRM and executive reports exist, but there is no service-specific reporting layer.

- Mobile Enquiry  
  The responsive web UI can be used on mobile, but there is no dedicated mobile application or mobile-specific data-entry experience.

## Missing features, ordered from easiest to hardest

### Priority 1 — Easiest and highest practical value

These can reuse the current CRM, procurement, inventory, and reporting models.

1. Price Lists — BUILT (2026-08-18, SYSTEM.md §5e)

   Customer/product rates with validity dates, wired into the Quotations form's rate auto-fill.
   Discounts were not built — only a flat rate per item/customer/validity window, matching what
   the quotation form itself already supports (a plain rate field, no discount concept).

2. Dedicated Sales Enquiry view — BUILT (2026-08-18, SYSTEM.md §5e)

   Sales → Enquiry, the same Leads component pre-filtered to `status='new'` — that status already
   was the raw-enquiry bucket (the SLA flag already treated it that way). No new table.

3. Sales Agent Performance — BUILT (2026-08-18, SYSTEM.md §5e)

   Reports → Agent Performance, built from existing lead, opportunity, task, and assignment data:

   - Leads assigned — real, off `leads.assigned_to`
   - Follow-up completion — real, off `tasks.assigned_to`/`status`
   - Conversion rate — real, off `leads.status`
   - Won value — approximated by opportunity creator; `opportunities` has no per-agent owner field
   - Lost reasons — same approximation as Won value
   - Average response time — approximated as time to a lead's first logged note; no first-contact timestamp exists

4. Vendor Analysis — BUILT (2026-08-18, SYSTEM.md §5c)

   Shipped as Procurement's Suppliers → Analysis (Dashboard + By Supplier views): spend, quote
   count, quotes won, and win rate per supplier, derived from existing quotes and issued POs.
   Called "Analysis" in the app, not "Vendor Analysis" — Suppliers is the one name for this entity
   throughout Shanti Ops.

5. Vendor Rating — STILL MISSING, on purpose

   Not built alongside Analysis: a real delivery-reliability score needs `received_ref` (currently
   free text) split into a structured receipt date first, so it can be diffed against the quoted
   expected delivery date. Faking a score off unstructured text was rejected. Everything else on
   the original list (price competitiveness, quality results, responsiveness, rejection/return
   history) is still open too.

6. Purchase Card — BUILT (2026-08-18, SYSTEM.md §5c)

   Shipped as Procurement's Suppliers → Analysis, By Item view: every logged quote for one material
   across every supplier and project, with a price-trend line once there's enough history.

7. Service Reports

   Add reports around installation milestones, site tasks, delays, customer issues, and commissioning completion.

8. Minimum Stock Level — BUILT, already existed before this audit

   `inventory_items.reorder_point` (same concept, inventory-management naming) plus a per-row "Low"
   badge already existed. The audit that flagged this as missing grepped for `reorder.?level`, not
   `reorder_point` — a search gap, not a real one. The one genuinely missing piece — a "below
   minimum" queue/filter, not just a badge — was added 2026-08-18 (SYSTEM.md §5e): a toggle on
   Stores' Inventory tab, plus the existing "low stock" summary chip now actually engages it
   instead of just jumping to a tab you're already on.

9. Basic Auto-Indent Suggestions

   Generate suggested procurement requests when available stock drops below the minimum level. Keep human approval before creating a real request.

10. Sales Offices and Branches — DEFERRED, by explicit decision (2026-08-18)

   No branch/office concept exists anywhere in the app, and no confirmed multi-branch operation
   exists today — the only real multi-entity axis is `company` (a 2-value legal entity, already
   fully built) and `leads.territory` (free text, read by nothing). Building a speculative
   master-data entity with no confirmed need was rejected as YAGNI, not skipped by oversight.
   Revisit if a real multi-office need shows up.

### Priority 2 — Moderate workflow additions

These require new tables, permissions, and some cross-module logic.

11. Sales Costing — BUILT (2026-08-18, SYSTEM.md §5e), post-sale only

   Real actual-cost-vs-quoted-value on the Sale Order, once it has a linked Project: issued-PO
   spend + logged job-card labor, compared against the quoted total. A pre-sale cost estimate on
   the Quotation was explicitly deferred — no real BOM/PO/labor data exists before a Project does,
   so it would need a hand-entered speculative number, not a derived one. That phase is noted, not
   built.

12. Sales Returns — BUILT (2026-08-18, SYSTEM.md §5e)

   New `sales_returns` table + Sales → Returns tab: return authorization, qty, reason, inspection
   outcome (pending/accepted/rejected), stock action (restock — credits real inventory on-hand,
   reusing the existing stock-increment pattern — or scrap), and a plain credit-note reference
   field (no ledger posting; that's the separate Tally-integration doc). Live-verified end to end.

13. Purchase Returns

   Add supplier return records linked to PO/GRN lines, returned quantity, reason, replacement/refund status, and stock adjustment.

14. Formal GIR

   Add Gate Inward Receipt with vehicle, supplier, driver, entry time, material reference, security check, and GRN linkage.

15. Returnable and Non-Returnable Gate Pass

   Add gate-pass records, item lists, expected return date, responsible person, approval, and returned/overdue status.

16. Multi-Level BOM

   Extend the current flat BOM into parent/subassembly relationships with roll-up quantities and drill-down views.

17. Where-Used List

   Once multi-level BOM exists, show every product/project/subassembly where a component is used.

18. Common/Uncommon List

   Add material classification and cross-project usage analysis to identify commonly reused versus one-off parts.

19. Engineering Change Note

   Add controlled BOM/design changes with:

   - Change reason
   - Affected projects
   - Old/new values
   - Approval
   - Effective revision
   - Downstream impact

20. Production Forecasting — BUILT (2026-08-19, SYSTEM.md §5l)

   Upcoming Work Orders, workstation load, and outstanding material demand off real released/
   in-progress Work Orders — their route cards' planned time and their material lines — not a
   synthetic prediction model. Production → Job Card → Forecast.

### Priority 3 — Larger manufacturing execution features

These should be designed together because they depend on one another.

21. Work Order / Production Order — BUILT (2026-08-19, SYSTEM.md §5l)

   `work_orders`: linked to a project (and its live BOM release baseline) or to stock replenishment,
   quantity, planned dates, and mode. The real production-order entity Job Cards (already built,
   see item 25 below) sit underneath.

22. Work Order Against Order — BUILT (2026-08-19, SYSTEM.md §5l)

   `work_orders.mode = 'against_order'` — linked to a project and its Sale Order.

23. Work Order Against Stock — BUILT (2026-08-19, SYSTEM.md §5l)

   `work_orders.mode = 'against_stock'` — no project required; `job_cards.project_id` made nullable
   to let its generated execution cards exist without one.

24. Process Route Card — BUILT (2026-08-19, SYSTEM.md §5l)

   `work_order_operations` — sequence, work centre (reuses the existing `operations`/`workstations`
   masters, §5g), planned time, department, inputs/outputs, quality checkpoint.

**Correction (2026-08-19):** items 25/26 below were previously listed as missing in this file. They
were not — Job Cards (milestone-scoped cards, time logs, qty done/rejected, rework lineage) shipped
2026-08-16 (SYSTEM.md §5g), before the Work Order work below even started. This file's own labels
were stale, not the app.

25. Job Card — BUILT EARLIER (2026-08-16, SYSTEM.md §5g, not this round)

   Milestone-scoped execution-level work cards already existed before this round's Work Order work
   — see the correction note above. A Work Order's "Generate Job Cards" action now creates them from
   its Route Card instead of requiring a hand-made card per step.

26. Job Card Process Tracking — BUILT EARLIER (2026-08-16, SYSTEM.md §5g, not this round)

   Start/end time (time logs), operator, quantity completed/rejected, and rework lineage already
   existed before this round — see the correction note above.

27. Work Order Process Tracking — BUILT (2026-08-19, SYSTEM.md §5l)

   Job-card completion, material consumption (read live off Stores' material-issue log), operation
   status per route step, and a delay/rework flag — all derived on a Work Order's detail view, no
   new tracking table.

28. Work Order Change Note — BUILT (2026-08-19, SYSTEM.md §5l)

   `work_order_change_notes` — once a Work Order is released, quantity/dates/product description can
   only move through a logged reason + old/new value, never a silent edit.

29. Work Order Costing — BUILT (2026-08-19, SYSTEM.md §5l)

   Planned vs. actual material and labour, extending Sales' existing `getProjectCosting()` (§5e)
   rather than a second cost rollup. Subcontracting/overhead: no vendor-cost or overhead-allocation
   field exists anywhere in this app, so outside job cards are listed, not fabricated into a number.

### Priority 4 — Quality and service expansion

30. Incoming Inspection Against PO

   Automatically create or suggest QC inspections when material is received against a PO/GRN.

31. Finished Goods Inspection

   Add final inspection tied to completed production orders and dispatch eligibility.

32. Semi-Finished/Subassembly Inspection

   Add inspection records for intermediate assemblies before they move to the next operation.

33. Job-Work Inspection

   Track material sent to an outside job worker, expected return, received quantity, quality result, and variance.

34. Instrument Calibration

   Add instrument master data, calibration schedule, certificate, due date, and blocked/expired status.

35. Jigs and Fixtures Calibration

   Add the same control for fixtures and shop-floor tooling.

36. Service Call Management

   Add customer complaints/service calls with priority, SLA, assignment, diagnosis, visit history, resolution, and closure evidence.

37. Service Contracts

   Add contract dates, covered equipment, visit frequency, entitlement, renewal, and service history.

38. Dedicated Service Reports

   Add service call aging, SLA compliance, repeat complaints, technician performance, contract renewals, and customer service history.

### Priority 5 — Finance, statutory, and regulated accounting

These are the hardest and should not be built casually inside the current operations database.

39. Sales Invoicing

40. Accounts Receivable

41. Accounts Payable

42. General Ledger

43. Multi-Level Chart of Accounts

44. Cost Centres

45. Budgeting

46. Bank Reconciliation

47. Trial Balance

48. Profit and Loss

49. Balance Sheet

50. Cash Flow/Fund Flow

51. Credit Notes and Debit Notes

52. Sales Returns linked to accounting

53. Purchase Returns linked to accounting

54. Cheque Printing

55. Fixed Assets

56. Depreciation and accounting journal generation

57. Forex Gain/Loss with journal entries

58. GSTR1

59. GSTR2

60. GSTR3 monthly return

61. GSTR7/TDS return

62. PF Registers

63. ESI Registers

64. Salary Auto-JV to Accounts

These need accounting periods, ledger posting rules, tax treatment, reconciliation, audit trails, statutory validation, and financial closing. The current architecture already documents these as ERPNext/accounting-integration territory.

### Priority 6 — Add-ons and integrations

65. Native Mobile App

   The current responsive web application is not the same as a native mobile app. A mobile app would need authentication, offline behavior, push notifications, camera/file handling, approvals, and mobile-specific workflows.

66. Automated Email Integration

   The system currently has email links and document generation, but not a reliable outbound email service with templates, delivery status, attachments, retries, and audit history.

67. Automated SMS Integration

   Requires provider integration, message templates, delivery status, rate limits, consent rules, and failure handling.

## Recommended implementation order

The best sequence for this product is:

1. Price Lists
2. Sales Enquiry view
3. Agent Performance reports
4. Vendor Analysis and Vendor Rating
5. Purchase Card
6. Minimum Stock Levels
7. Auto-Indent Suggestions
8. Sales Costing
9. GIR and Gate Pass
10. Sales/Purchase Returns
11. Multi-Level BOM, Where-Used, and ECN
12. Work Orders, Route Cards, and Job Cards
13. QC inspection expansion
14. Service Calls and Service Contracts
15. ERPNext/accounting integration
16. Native mobile app and automated email/SMS

This gives you the highest amount of competitor coverage without disturbing the existing core workflows. The biggest strategic gap is not CRM or procurement—the current system is already strong there. The largest gaps are formal production execution, service management, finance/statutory accounting, and native/integrated communication channels.