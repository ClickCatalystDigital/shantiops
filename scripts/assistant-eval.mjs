// Checks the assistant's decisions against a few hundred questions, using dry runs: one Jev call
// each, no writing model, no data read. About 400 questions cost roughly 3 US cents.
//   node scripts/assistant-eval.mjs              (dev server on :3015, demo admin login)
//   node scripts/assistant-eval.mjs --quick      (hand-written questions only)
//   BASE=http://localhost:3000 ADMIN_USER=admin ADMIN_PASS=... node scripts/assistant-eval.mjs
const BASE = process.env.BASE || 'http://localhost:3015';
const QUICK = process.argv.includes('--quick');
const DEPT_PATH = { Sales: '/sales', Marketing: '/market', Procurement: '/procurement', Stores: '/stores', Production: '/production/shop', QC: '/qc', Dispatch: '/dispatch', Installation: '/installation', HR: '/hr', Accounts: '/accounts', Engineering: '/engineering', Design: '/calc' };

// [question, screen, expected kind, expectation]
//   howto: words, one of which must be in the chosen section's name ([] = any section)
//   data:  the look-up that must be chosen ('none' = no look-up fits)
const HAND = [
  // ---- how-to, plainly asked
  ['How do I raise a purchase request?', '/pr', 'howto', ['purchase request']],
  ['How do I crop the company logo?', '/accounts', 'howto', ['logo']],
  ['Where do I close a gate inward receipt?', '/stores', 'howto', ['gate']],
  ['how to cut a plate and send the remnant back', '/production/shop', 'howto', ['remnant', 'cut']],
  ['How do I send a quotation to the customer by email?', '/sales', 'howto', ['quotation', 'email']],
  ['customer did not get the portal password, what do I do', '/sales', 'howto', ['portal']],
  ['How do I submit a packing list for approval before dispatch?', '/dispatch', 'howto', ['approval']],
  ['where do I record a payment received against an invoice', '/accounts', 'howto', ['settlement', 'ledger', 'invoice', 'payment']],
  ['How do I add a new company?', '/accounts', 'howto', ['company']],
  ['how can I change the footer on the purchase order', '/accounts', 'howto', ['logo', 'document', 'company']],
  ['How do I create a job card?', '/production/shop', 'howto', ['job card', 'how to']],
  ['how do I hand over finished items to dispatch', '/production/shop', 'howto', ['dispatch', 'hand']],
  ['How do I issue a purchase order?', '/procurement', 'howto', ['purchase order']],
  ['how to compare supplier quotes and pick one', '/procurement', 'howto', ['selection', 'comparison', 'quote', 'enquiry']],
  ['Where do I see which deliveries are late?', '/procurement', 'howto', ['overdue', 'delivery', 'inbound']],
  ['How do I reserve stock for a project?', '/stores', 'howto', ['reserv', 'demand', 'allocation', 'inventory', 'stock']],
  ['how do I receive material that came today', '/stores', 'howto', ['inward', 'receiv', 'grn', 'gate', 'how to']],
  ['How do I add a test certificate?', '/qc', 'howto', ['certificate']],
  ['how do I raise an NCR', '/qc', 'howto', ['ncr']],
  ['How do I release a hold point?', '/qc', 'howto', ['hold', 'release']],
  ['how to generate the QC folder pdf', '/qc', 'howto', ['document', 'statutory', 'folder', 'qc']],
  ['How do I combine two packing lists into one shipment?', '/dispatch', 'howto', ['shipment', 'packing']],
  ['how do I make a gate pass', '/dispatch', 'howto', ['gate pass']],
  ['How do I log a service visit?', '/installation', 'howto', ['visit', 'service']],
  ['how to claim travel expenses', '/service-expenses', 'howto', ['expense', 'travel', 'cash']],
  ['How do I mark attendance for workers?', '/hr', 'howto', ['attendance', 'daily']],
  ['how do I run payroll for this month', '/hr', 'howto', ['payroll', 'salary']],
  ['How do I add a new employee?', '/hr', 'howto', ['employee', 'onboard', 'people', 'how to']],
  ['how do I post a manual journal entry', '/accounts', 'howto', ['journal', 'ledger']],
  ['How do I reconcile the bank statement?', '/accounts', 'howto', ['bank']],
  ['where do I file GSTR-1', '/accounts', 'howto', ['gst']],
  ['how do I lock the books for last year', '/accounts', 'howto', ['lock', 'ledger', 'period', 'how to']],
  ['How do I release the BOM?', '/engineering', 'howto', ['bom', 'release']],
  ['how do I import a PMB excel', '/engineering', 'howto', ['bom', 'pmb', 'import']],
  ['how to raise an engineering change note', '/engineering', 'howto', ['change']],
  ['How do I save a BOM as a template?', '/engineering', 'howto', ['template']],
  ['how do I approve a drawing', '/calc-drawings', 'howto', ['drawing']],
  ['How do I create a new enquiry?', '/sales', 'howto', ['enquir']],
  ['how do I record that we lost an order', '/sales', 'howto', ['lost']],
  ['How do I convert a quotation into a sale order?', '/sales', 'howto', ['quotation', 'sale order']],
  ['where can I see my follow ups for this week', '/sales', 'howto', ['planner', 'follow', 'diary', 'activit']],
  ['how do I give a customer access to the portal', '/sales', 'howto', ['portal']],
  ['How do I split an order into units?', '/projects', 'howto', ['split', 'unit', 'project']],
  ['how do I change which alerts I get by email', '/settings', 'howto', ['alert', 'notification']],
  ['How do I connect WhatsApp?', '/settings', 'howto', ['whatsapp']],
  // ---- how-to, mistyped (must still be understood)
  ['how do i rais a purchse reqest', '/pr', 'howto', ['purchase request']],
  ['how to creat quotaton for custmer', '/sales', 'howto', ['quotation']],
  ['where is pakcing list aproval', '/dispatch', 'howto', ['approval', 'packing']],
  ['how to add test certifcate', '/qc', 'howto', ['certificate']],
  ['how do i reconsile bank statment', '/accounts', 'howto', ['bank']],
  ['hw to mark attendence', '/hr', 'howto', ['attendance', 'daily']],
  ['how to relese the bom', '/engineering', 'howto', ['bom', 'release']],
  ['how do I issue purchse ordr to suplier', '/procurement', 'howto', ['purchase order']],
  ['whre to uplod company logo', '/accounts', 'howto', ['logo']],
  ['how to recieve material in stors', '/stores', 'howto', ['inward', 'receiv', 'grn', 'gate', 'how to']],
  // ---- live data
  ['How much does HKM owe us right now?', '/sales', 'data', 'customer_outstanding'],
  ['Which customers owe us the most?', '/sales', 'data', 'customer_outstanding'],
  ['total outstanding from NSL Sugars', '/accounts', 'data', 'customer_outstanding'],
  ['who has not paid us yet', '/sales', 'data', 'customer_outstanding'],
  ['What is the status of project SB-1109-01-50?', '/projects', 'data', 'project_status'],
  ['is SB-1040 delayed', '/projects', 'data', 'project_status'],
  ['which stage is STF-IBR-052 at', '/projects', 'data', 'project_status'],
  ['how far along is project SB-1108', '/', 'data', 'project_status'],
  ['How much has been received against order SB-1108?', '/sales', 'data', 'order_payment'],
  ['what is pending on order SAS-322', '/sales', 'data', 'order_payment'],
  ['order value of SB-1057', '/accounts', 'data', 'order_payment'],
  ['Which purchase orders are still not received?', '/procurement', 'data', 'open_purchase_orders'],
  ['Which purchase orders are late this week?', '/procurement', 'data', 'open_purchase_orders'],
  ['list POs waiting for delivery', '/stores', 'data', 'open_purchase_orders'],
  ['How much MS angle do we have in stock?', '/stores', 'data', 'stock_on_hand'],
  ['do we have any BQ plate 12 mm', '/stores', 'data', 'stock_on_hand'],
  ['stock of gaskets', '/stores', 'data', 'stock_on_hand'],
  ['how many safety valves are on hand', '/production/shop', 'data', 'stock_on_hand'],
  ['Which items are below minimum stock?', '/stores', 'data', 'low_stock'],
  ['what do we need to reorder', '/stores', 'data', 'low_stock'],
  ['What approvals are waiting?', '/qc', 'data', 'pending_approvals'],
  ['any packing lists waiting for my approval', '/qc', 'data', 'pending_approvals'],
  ['how many inward reviews are pending', '/qc', 'data', 'pending_approvals'],
  ['What are my open tasks?', '/', 'data', 'open_tasks'],
  ['what is pending for my department today', '/', 'data', 'open_tasks'],
  ['What was our profit last month?', '/accounts', 'data', 'none'],
  ['how many employees were absent yesterday', '/hr', 'data', 'none'],
  ['what is the salary of the production head', '/hr', 'data', 'none'],
  ['how much did we spend on steel this year', '/procurement', 'data', 'none'],
  ['hw much does hkm ow us', '/sales', 'data', 'customer_outstanding'],
  ['stok of ms angel', '/stores', 'data', 'stock_on_hand'],
  // ---- greetings and thanks (fixed reply)
  ['hi', '/', 'smalltalk'], ['hello there', '/sales', 'smalltalk'], ['thanks, that helped', '/', 'smalltalk'],
  ['good morning', '/', 'smalltalk'], ['ok got it', '/stores', 'smalltalk'], ['thank you so much', '/', 'smalltalk'],
  ['great', '/', 'smalltalk'], ['bye', '/', 'smalltalk'],
  // ---- nothing to do with the app (fixed reply)
  ['What is the capital of France?', '/', 'other'], ['write me a poem about boilers', '/', 'other'],
  ['what is the weather in Hyderabad today', '/stores', 'other'], ['who won the cricket match yesterday', '/', 'other'],
  ['translate good morning to Telugu', '/', 'other'], ['write a python script to sort a list', '/engineering', 'other'],
  ['what is the GST rate on gold jewellery', '/accounts', 'other'], ['tell me a joke', '/', 'other'],
  ['what is the best phone under 20000', '/', 'other'], ['who is the prime minister of India', '/', 'other'],
  ['recommend a good restaurant near Nacharam', '/', 'other'], ['explain quantum computing', '/', 'other'],
  // ---- cannot be understood (fixed reply)
  ['asdfgh', '/', 'unclear'], ['???', '/', 'unclear'], ['jjjjjj kkkk', '/sales', 'unclear'], ['the', '/', 'unclear'],
  ['qwerty uiop zxcv', '/', 'unclear'], ['xx', '/stores', 'unclear'], ['.....', '/', 'unclear'], ['hgfd poiu mnbv', '/qc', 'unclear'],
  ['it', '/', 'unclear'], ['aaa bbb ccc', '/', 'unclear'],
];

// ---- actions: [sentence, screen, the action the card must be for]. EVAL_ONLY=actions runs only these.
const ACT = [
  ['add an enquiry from Lotus Breweries, phone 9845011223', '/sales', 'add_enquiry'], ['new lead: Coastal Fisheries wants a 2 TPH boiler', '/', 'add_enquiry'],
  ['spoke to Metro Hospital Trust, they want the revised offer by Friday', '/sales', 'log_followup'], ['met Kaveri Pharma today, they are comparing two offers', '/', 'log_followup'],
  ['move the Harvest Rice Mills enquiry to proposals', '/sales', 'set_enquiry_stage'], ['Kaveri Pharma enquiry is now a hot offer', '/sales', 'set_enquiry_stage'],
  ['assign the Kaveri Pharma enquiry to Rohan', '/sales', 'assign_enquiry'], ['give the Metro Hospital lead to Rohan to follow up', '/', 'assign_enquiry'],
  ['Metro Hospital Trust enquiry is worth 42 lakh', '/sales', 'set_enquiry_value'], ['set the expected value of the Harvest Rice Mills enquiry to 15 lakh', '/', 'set_enquiry_value'],
  ['add customer Deccan Agro Foods, email accounts@deccanagro.example', '/sales', 'add_customer'], ['create a new customer called Pioneer Spinning Mills', '/', 'add_customer'],
  ['mark QTN-7 as sent', '/sales', 'quotation_sent'], ['I emailed the Greenfield offer QTN-7 to the customer', '/', 'quotation_sent'],
  ['Greenfield accepted QTN-7', '/sales', 'quotation_accepted'], ['we won the Metro Hospital offer QTN-1', '/', 'quotation_accepted'],
  ['Metro Hospital said no to QTN-1', '/sales', 'quotation_rejected'], ['QTN-7 is lost, the customer went with another supplier', '/', 'quotation_rejected'],
  ['received 2.5 lakh from Northstar against SO-4 by NEFT', '/sales', 'record_order_payment'], ['Greenfield paid an advance of 5 lakh on SO-5', '/', 'record_order_payment'],
  ['site marking started on AB-1005', '/projects', 'start_milestone'], ['we have begun box up on AB-1005', '/', 'start_milestone'],
  ['box up welding is done on AB-1005', '/projects', 'close_milestone'], ['close the box up milestone on AB-1005', '/', 'close_milestone'],
  ['send Release All Drawings on AB-1004 back for rework', '/projects', 'send_back_milestone'], ['reopen the design milestone on AB-1004, the customer changed the nozzles', '/', 'send_back_milestone'],
  ['add a task to check the hydro pump calibration by Friday', '/', 'add_task'], ['remind the team to clean the paint booth tomorrow', '/', 'add_task'],
  ['ask Stores to keep two BQ plates for AB-1005 by tomorrow', '/', 'raise_request'], ['tell Procurement we need gaskets for AB-1003 urgently', '/', 'raise_request'],
  ['the Boiler Expo lead list has been sent to Sales, close that task', '/', 'complete_task'], ['mark the task revise tube layout for AB-1005 done', '/', 'complete_task'],
  ['add supplier Shree Valves, phone 9822001122', '/procurement', 'add_supplier'], ['new vendor: Bharat Refractories, Hosur', '/', 'add_supplier'],
  ['Prime Steel Traders quoted 68 per kg for the BQ plate 16 mm on AB-1004', '/procurement', 'record_supplier_quote'], ['National Tube Co gave a price of 410 per metre for boiler tube on AB-1004', '/', 'record_supplier_quote'],
  ['issue purchase order 123/AB/2026-27', '/procurement', 'issue_po'], ['send the draft PO to Shield Valves, it is final', '/', 'issue_po'],
  ['cancel purchase order 123/AB/2026-27, not needed', '/procurement', 'cancel_po'], ['the Shield Valves PO is no longer required, cancel it', '/', 'cancel_po'],
  ['truck KA 01 AB 4321 arrived from Prime Steel Traders with plates', '/stores', 'log_gate_entry'], ['a vehicle from National Tube Co is at the gate with tubes', '/', 'log_gate_entry'],
  ['issue 2 nos of MS angle 50 x 50 to production for AB-1004', '/stores', 'issue_material'], ['give the shop floor 4 boiler tubes for AB-1004', '/', 'issue_material'],
  ['approve the 12 mm BQ plate on inward inspection', '/qc', 'approve_inward'], ['the BQ plate that came in for AB-1004 is fine, clear it for use', '/', 'approve_inward'],
  ['reject the MS angle that came in, it is bent', '/qc', 'reject_inward'], ['the boiler tubes received for AB-1004 failed inspection', '/', 'reject_inward'],
  ['hydro test passed on AB-1003', '/qc', 'add_qc_record'], ['radiography on AB-1005 shell seam is pending', '/', 'add_qc_record'],
  ['change the incoming inspection on AB-1001 to fail', '/qc', 'set_qc_result'], ['the hydro test on AB-1003 actually failed, update the result', '/', 'set_qc_result'],
  ['raise a major NCR on AB-1005: weld porosity on shell seam', '/qc', 'raise_ncr'], ['found a dent in the AB-1003 shell, log a non-conformance', '/', 'raise_ncr'],
  ['approve PL-1005 for dispatch', '/qc', 'decide_predispatch'], ['reject the packing list PL-1005 in pre-dispatch review, nameplate missing', '/', 'decide_predispatch'],
  ['delete the hydro test record on AB-1003, it was entered twice', '/qc', 'delete_qc_record'], ['remove the wrong QC test entry on AB-1001', '/', 'delete_qc_record'],
  ['start marking on shell for JC-1029, fitter Vikram Rao', '/production/shop', 'start_jobcard_stage'], ['Vikram has started the radiographic testing stage on JC-1029', '/', 'start_jobcard_stage'],
  ['shell belt welding is finished on JC-1029', '/production/shop', 'finish_jobcard_stage'], ['furnace alignment is complete on job card JC-1029', '/', 'finish_jobcard_stage'],
  ['mark packing list PL-1005 packed', '/dispatch', 'set_packing_status'], ['PL-1005 has been dispatched', '/', 'set_packing_status'],
  ['submit PL-1005 for dispatch approval', '/dispatch', 'submit_packing_approval'], ['send packing list PL-1005 to QC and production for sign-off', '/', 'submit_packing_approval'],
  ['delete draft packing list PL-1006', '/dispatch', 'delete_packing_list'], ['remove the packing list PL-1006, made by mistake', '/', 'delete_packing_list'],
  ['Priya Nair is absent today', '/hr', 'mark_attendance'], ['mark Vikram Rao half day yesterday', '/', 'mark_attendance'],
  ['casual leave for Ananya Iyer from 12 Nov to 13 Nov', '/hr', 'apply_leave'], ['Rohan needs sick leave tomorrow', '/', 'apply_leave'],
  ['plan a commissioning visit to AB-1001 on 20 Nov', '/installation', 'log_service_visit'], ['our engineer visited AB-1002 today for a breakdown', '/', 'log_service_visit'],
  ['delete the Lotus Breweries enquiry, it was a duplicate', '/sales', 'delete_enquiry'], ['remove the duplicate Harvest Rice Mills lead', '/', 'delete_enquiry'],
];

// Added 2026-11-08 (the second set of actions). EVAL_ONLY=new runs only these.
const ACT_NEW = [
  ['Metro Hospital Trust enquiry: the phone number is 98450 22334', '/sales', 'edit_enquiry_contact'], ['correct the email on the Kaveri Pharma enquiry to buy@kaveri.example', '/', 'edit_enquiry_contact'],
  ['make the Harvest Rice Mills enquiry a customer', '/sales', 'convert_enquiry'], ['convert the Metro Hospital lead into a customer', '/', 'convert_enquiry'],
  ['close the sales call on Harvest Rice Mills, nothing more to follow up', '/sales', 'close_sales_call'], ['stop following up the Kaveri Pharma enquiry for now', '/', 'close_sales_call'],
  ['add a follow-up to send the Kaveri Pharma brochure by Friday', '/sales', 'add_crm_task'], ['remind me to call Metro Hospital back on Monday', '/', 'add_crm_task'],
  ['the Kaveri Pharma brochure follow-up is done', '/sales', 'complete_crm_task'], ['I called Metro Hospital back, mark that follow-up done', '/', 'complete_crm_task'],
  ['move the second boiler for the new plant opportunity to hot offers', '/pipeline', 'set_opportunity_stage'], ['the Sunrise Dairy second boiler deal is now at proposals', '/', 'set_opportunity_stage'],
  ['approve the discount on QTN-8', '/sales', 'approve_quotation_discount'], ['the extra discount on the Greenfield offer QTN-8 is fine, approve it', '/', 'approve_quotation_discount'],
  ['make a sale order from QTN-8', '/sales', 'convert_quotation_to_order'], ['convert the accepted quotation QTN-8 into a sale order', '/', 'convert_quotation_to_order'],
  ['mark SO-4 as ready', '/sales', 'set_order_status'], ['SO-3 has been dispatched, update the order tracker', '/', 'set_order_status'],
  ['received 50,000 against invoice AB/2/2026-27 by NEFT', '/accounts', 'record_invoice_receipt'], ['Bluewave paid 1 lakh on invoice AB/3/2026-27', '/', 'record_invoice_receipt'],
  ['create a project for Lotus Breweries', '/projects', 'create_project'], ['open a new boiler project for Coastal Fisheries', '/', 'create_project'],
  ['release the BOM of SO-5', '/engineering', 'release_bom'], ['the bill of materials for SO-5 is ready, release it to procurement', '/', 'release_bom'],
  ['approve the change note on the feed pump for AB-1004', '/engineering', 'set_ecn_status'], ['reject the ECN to change the feed pump make on AB-1004', '/', 'set_ecn_status'],
  ['cancel the blow down valve line on AB-1004, not needed', '/engineering', 'cancel_bom_line'], ['we no longer need the pressure gauge on AB-1004, cancel that BOM line', '/', 'cancel_bom_line'],
  ['send the pressure gauge on AB-1004 to procurement', '/stores', 'raise_pr_for_line'], ['raise a purchase request for the blow down valve on AB-1004', '/', 'raise_pr_for_line'],
  ['spoke to the supplier about the water level gauge on AB-1004, it ships Monday', '/procurement', 'add_delivery_followup'], ['Shield Valves says the stop valve for AB-1004 is delayed by a week', '/', 'add_delivery_followup'],
  ['schedule 1 of the stay tube on PO 101 for 25 Nov', '/procurement', 'add_delivery_lot'], ['the supplier will deliver 10 boiler tubes of the AB-1004 order on 2 Dec, add a delivery lot', '/', 'add_delivery_lot'],
  ['record the supplier bill against purchase order 101', '/procurement', 'record_vendor_bill'], ['Prime Steel sent their invoice for the plates PO, record the bill', '/', 'record_vendor_bill'],
  ['approve the bill EMB-501', '/procurement', 'approve_vendor_bill'], ['the Prime Steel bill is checked, approve it for payment', '/', 'approve_vendor_bill'],
  ['paid 1000 on bill EMB-501 by RTGS', '/accounts', 'pay_vendor_bill'], ['we paid Prime Steel 2 lakh against their bill', '/', 'pay_vendor_bill'],
  ['received 2 nos of the stay tube for AB-1004', '/stores', 'receive_bom_line'], ['the boiler tubes for AB-1004 arrived today, receive them', '/', 'receive_bom_line'],
  ['open a stock receipt from Prime Steel Traders', '/stores', 'add_stock_receipt'], ['start an inward batch for the National Tube Co delivery', '/', 'add_stock_receipt'],
  ['reserve 2 MS channel from stock for the AB-1004 support line', '/stores', 'reserve_stock'], ['keep 20 kg of MS plate in stock aside for AB-1005', '/', 'reserve_stock'],
  ['reserve piece PL-H10M2201-001-R8 for the feed check valve on AB-1004', '/stores', 'reserve_piece'], ['hold the plate remnant PL-H10M2201-001-R8 for AB-1005', '/', 'reserve_piece'],
  ['issue the reserved gasket spiral wound for AB-1005 to production', '/stores', 'issue_reservation'], ['hand over the reserved stud bolts for AB-1005 to the shop floor', '/', 'issue_reservation'],
  ['release the stud bolt reservation on AB-1005', '/stores', 'release_reservation'], ['un-reserve the safety valve kept for AB-1005, it is free again', '/', 'release_reservation'],
  ['scrap the returned piece PL-H10M2201-001-R9', '/stores', 'scrap_piece'], ['the offcut that came back from the shop floor is useless, scrap it', '/', 'scrap_piece'],
  ['close gate entry 1001', '/stores', 'close_gate_entry'], ['the material from gate entry 1002 is received, close it', '/', 'close_gate_entry'],
  ['gate pass for the old pump going to Shree Motors for repair, returnable by 30 Nov', '/stores', 'create_gate_pass'], ['make a gate pass for scrap going to Metro Scrap Dealers', '/', 'create_gate_pass'],
  ['approve gate pass GP-1', '/dispatch', 'approve_gate_pass'], ['the Shree Motors gate pass is fine, approve it', '/', 'approve_gate_pass'],
  ['issue gate pass GP-1', '/dispatch', 'issue_gate_pass'], ['the pump left the gate on gate pass GP-1', '/', 'issue_gate_pass'],
  ['cancel gate pass GP-1', '/dispatch', 'cancel_gate_pass'], ['the Shree Motors gate pass is not needed any more, cancel it', '/', 'cancel_gate_pass'],
  ['NCR-1001: use as is', '/qc', 'disposition_ncr'], ['the porosity NCR on AB-1005 needs rework', '/', 'disposition_ncr'],
  ['verify NCR-1001', '/qc', 'verify_ncr'], ['QC checked the rework on NCR-1001, it is fine now', '/', 'verify_ncr'],
  ['close NCR-1001', '/qc', 'close_ncr'], ['NCR-1001 is verified, close it', '/', 'close_ncr'],
  ['release JC-1025 from QC hold', '/qc', 'qc_release_job_card'], ['QC has checked job card JC-1025, let production continue', '/', 'qc_release_job_card'],
  ['Ramesh Kumar worked 2 hours on JC-1024', '/production/shop', 'log_job_card_time'], ['log 45 minutes by Suresh Yadav on job card JC-1026', '/', 'log_job_card_time'],
  ['Suresh Yadav is present today on the shop floor', '/production/shop', 'mark_worker_day'], ['mark welder Mahesh Pawar half day on the daily sheet', '/', 'mark_worker_day'],
  ['make a packing list for AB-1005', '/dispatch', 'create_packing_from_bom'], ['generate the packing list from the BOM for AB-1004', '/', 'create_packing_from_bom'],
  ['Bluewave received PL-1004 fine', '/dispatch', 'acknowledge_delivery'], ['the customer says two boxes on PL-1004 arrived damaged', '/', 'acknowledge_delivery'],
  ['ship PL-1008 and PL-1009 together on truck MH 12 AB 1234', '/dispatch', 'create_shipment'], ['combine packing lists PL-1008 and PL-1009 into one shipment', '/', 'create_shipment'],
  ["approve Divya Menon's leave", '/hr', 'approve_leave'], ['Divya Menon can take her leave, approve it', '/', 'approve_leave'],
  ["reject Ananya Iyer's casual leave", '/hr', 'reject_leave'], ['we cannot spare Divya Menon next week, reject her leave', '/', 'reject_leave'],
  ['give Priya Nair 12 days of earned leave for 2026', '/hr', 'allocate_leave'], ['allocate 6 sick leave days to Rohan Mehta this year', '/', 'allocate_leave'],
  ['Vikram Rao spent 850 on a taxi to the site today', '/hr', 'submit_expense_claim'], ['claim 1200 for the hotel stay during the commissioning visit', '/', 'submit_expense_claim'],
  ["approve Vikram Rao's expense claim", '/hr', 'approve_expense_claim'], ['the taxi claim from Vikram is fine, approve it', '/', 'approve_expense_claim'],
  ["reject Vikram Rao's expense claim, no bill", '/hr', 'reject_expense_claim'], ['turn down the hotel expense claim, it was not approved beforehand', '/', 'reject_expense_claim'],
  ['gave Karan Joshi an advance of 5000 today', '/hr', 'record_advance'], ['Neha Gupta took a salary advance of 3000', '/', 'record_advance'],
  ['loan of 60000 to Sanjay Patil over 12 months', '/hr', 'record_loan'], ['Amit Shah is taking a 1 lakh loan, to be repaid in 10 months', '/', 'record_loan'],
  ['move Ravi Kulkarni to interview', '/hr', 'set_applicant_status'], ['we are hiring Ravi Kulkarni, mark him hired', '/', 'set_applicant_status'],
  ['Sunrise Dairy called, the boiler on AB-1001 has a steam leak, urgent', '/installation', 'log_service_call'], ['log a complaint from Riverside Textiles on AB-1002: the burner trips', '/', 'log_service_call'],
  ['the steam leak service call on AB-1001 is resolved', '/installation', 'set_service_call_status'], ['service call 1001 for the feed pump noise is now in progress', '/', 'set_service_call_status'],
  ['visited the steam leak call on AB-1001 today, replaced the gasket', '/installation', 'add_service_call_visit'], ['our technician went for service call 1002 and changed the pump seal', '/', 'add_service_call_visit'],
  ['approve CR-9001', '/approvals', 'approve_service_expense'], ['the service engineer cash request CR-9001 is fine, approve it', '/', 'approve_service_expense'],
  ['reject CR-9002, no bills attached', '/approvals', 'reject_service_expense'], ['turn down the service travel claim CR-9002, too high', '/', 'reject_service_expense'],
  ['settle CR-9003', '/accounts', 'settle_service_expense'], ['pay out the approved service expense CR-9003', '/', 'settle_service_expense'],
  ['finalize report FSR-9001', '/installation', 'finalize_service_report'], ['the breakdown report FSR-9001 is complete, lock it', '/', 'finalize_service_report'],
  ['share FSR-1001 with the customer', '/installation', 'share_service_report'], ['put the commissioning report FSR-1001 on the customer portal', '/', 'share_service_report'],
];

const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'admin123' }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!login.ok || !cookie) { console.error('Login failed'); process.exit(1); }
const post = body => fetch(`${BASE}/api/assistant/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, body: await r.json() }));

// One generated question per guide section: "How do I use <section>?" must come back to that section.
const ONLY = process.env.EVAL_ONLY; // 'actions' | 'new' | 'cards' | unset (everything)
let cases = ONLY ? [] : HAND.map(c => ({ q: c[0], path: c[1], kind: c[2], want: c[3], group: c[2] === 'howto' ? 'how-to (written by hand)' : c[2] }));
if (ONLY === 'new') cases.push(...ACT_NEW.map(([q, path, want]) => ({ q, path, kind: 'action', want, group: 'actions (second set)' })));
else if (ONLY !== 'cards') cases.push(...[...ACT, ...ACT_NEW].map(([q, path, want]) => ({ q, path, kind: 'action', want, group: 'actions' })));
// Every Cue Card on the page (lib/cue-cards.js), as the admin sees them: it must trigger what the card says.
if (ONLY !== 'actions' && ONLY !== 'new') {
  const cc = await fetch(`${BASE}/api/assistant/cue-cards`, { headers: { cookie } }).then(r => r.json());
  for (const c of cc.cards) cases.push({ q: c.q, path: '/', kind: c.expect.type, want: c.expect.type === 'action' ? c.expect.action : c.expect.type === 'data' ? c.expect.tool : [], group: 'cue cards' });
}
if (!QUICK && !ONLY) {
  const { body } = await post({ list: true });
  for (const s of body.sections.filter(s => s.key !== 'intro' && s.key !== 'how-to')) {
    cases.push({ q: `How do I use ${s.label}?`, path: DEPT_PATH[s.dept] || '/', kind: 'howto', want: [s.label.toLowerCase()], group: 'how-to (one per guide section)' });
    cases.push({ q: `where is ${s.label.toLowerCase()} and what is it for`, path: '/', kind: 'howto', want: [s.label.toLowerCase()], group: 'how-to (one per guide section, from Home)' });
  }
}

const tally = {}, misses = [];
let reachedModel = 0;
async function run(c) {
  const { ok, body: r } = await post({ dry: true, assumeData: true, path: c.path, messages: [{ role: 'user', content: c.q }] });
  if (!ok) { console.error(`STOP: ${r.error}`); process.exit(1); }
  // Every section Jev chose is sent to the writing model, so a match in any of them counts.
  const chosen = (r.sections || []).join(' | ').toLowerCase();
  const good = r.kind === c.kind && (
    c.kind === 'howto' ? (!c.want.length || c.want.some(n => chosen.includes(n)))
    : c.kind === 'data' ? (r.tool || 'none') === c.want
    : c.kind === 'action' ? r.action === c.want
    : true);
  if (r.kind === 'action' && c.kind !== 'action') r.trace.push('ACTION CARD where none was asked'); const t = (tally[c.group] ??= { n: 0, ok: 0 }); t.n++; t.ok += good;
  // A question that should get a fixed reply must never be passed to the writing model.
  if (['smalltalk', 'other', 'unclear'].includes(c.kind) && r.answer === null) reachedModel++;
  if (!good) misses.push(`${c.q}\n       wanted ${c.kind}${c.want?.length ? ` / ${[].concat(c.want).join(' | ')}` : ''}; got ${r.trace.join(' · ')}`);
}
for (let i = 0; i < cases.length; i += 6) await Promise.all(cases.slice(i, i + 6).map(run));

if (misses.length) console.log(`MISSES\n${misses.map(m => `  ${m}`).join('\n')}\n`);
for (const [g, t] of Object.entries(tally)) console.log(`${String(t.ok).padStart(4)} of ${String(t.n).padEnd(4)} ${g}`);
const total = Object.values(tally).reduce((a, t) => ({ n: a.n + t.n, ok: a.ok + t.ok }), { n: 0, ok: 0 });
console.log(`\n${total.ok} of ${total.n} as expected. Greetings / unrelated / unclear questions that would have reached the writing model: ${reachedModel}`);
