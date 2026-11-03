// Product capabilities shown on the sign-in and demo pages: only things the product does today.
import { IS_US } from './market.js';
import { FileCheck2Icon, LayersIcon, QrCodeIcon, LandmarkIcon, BellIcon, UsersIcon, RecycleIcon, GaugeIcon, MessageCircleIcon, ShieldCheckIcon } from 'lucide-react';

const IN_FEATURES = [
  [FileCheck2Icon, 'IBR folder in one click', 'Form II, III, III A and IV A built from the certificates already linked to each part.'],
  [LayersIcon, 'Excel PMB to a structured BOM', 'Upload the workbook; the tree, categories and catalog links are filled in for review.'],
  [RecycleIcon, 'Plate-to-part traceability', 'Heat numbers follow every cut, and usable remnants return to stock for the next order.'],
  [QrCodeIcon, 'Customer portal and nameplate QR', 'Customers follow their order, download documents and see service visits.'],
  [LandmarkIcon, 'Accounts built in', 'GST, TDS, ledger, bank reconciliation and financial statements for each company.'],
  [BellIcon, 'Alerts that reach the right person', 'Each person chooses bell or email per alert; the owner gets a morning brief.'],
  [MessageCircleIcon, 'WhatsApp for quotations and RFQs', 'Send offers to customers and enquiries to suppliers on WhatsApp in one click.'],
  [GaugeIcon, 'Owner view', 'On-track status, cash outstanding and approvals waiting on one page.'],
  [ShieldCheckIcon, 'Device and data security', 'USB drives, phones and websites stay locked on office PCs until a manager approves.'],
  [UsersIcon, 'CRM to cash', 'Leads from IndiaMART, TradeIndia, JustDial and your website become enquiries, quotations, orders and payments.'],
];

// Outside services SB Ops connects to, each one built: WhatsApp Cloud API, SMTP email (Gmail, Zoho or any
// provider), lead sources, AI through OpenRouter (Gemini reads documents), Cloudflare R2 file storage.
// Logos in public/integrations: simple-icons (CC0) for WhatsApp, Gmail, Zoho, Gemini, Cloudflare; IndiaMART,
// TradeIndia and JustDial are each company's own logo file. (NIC e-way bill: add once it has run against NIC.)
const IN_INTEGRATIONS = [
  ['WhatsApp', '/integrations/whatsapp.svg'],
  ['Gmail', '/integrations/gmail.svg'],
  ['Zoho Mail', '/integrations/zoho.svg'],
  ['IndiaMART', '/integrations/indiamart.png'],
  ['TradeIndia', '/integrations/tradeindia.png'],
  ['JustDial', '/integrations/justdial.svg'],
  ['Website forms', null],
  ['Gemini AI', '/integrations/googlegemini.svg'],
  ['Cloudflare storage', '/integrations/cloudflare.svg'],
];

// The /demo page's "in detail" sections (components/DemoEntry.jsx), one per FEATURES title, for visitors and
// search engines. Only what the product does today; no customer names.
const IN_FEATURE_DETAILS = {
  'IBR folder in one click': { id: 'ibr-folder', heading: 'IBR statutory folder generated from the BOM', body: [
    'The covering letter and Forms II(1), III, III A and IV A are built from the project\'s bill-of-materials tree and its bank of material test certificates, instead of being typed by hand for every boiler.',
    'The form set is chosen by boiler model, and the lettered sections of Form IV A follow the structure of the BOM itself. Certificate PDFs are read by AI when they are uploaded; matching a certificate to the part it covers is suggested, then confirmed by a person, because the result ends up in paperwork an inspector relies on.',
  ] },
  'Excel PMB to a structured BOM': { id: 'excel-bom-import', heading: 'Import the Excel project master BOM', body: [
    'Most boiler makers keep a master BOM workbook per project: one sheet per subsystem, one row per material, with columns each department fills in. Upload that workbook and it becomes a structured BOM tree with categories and links to the item catalog.',
    'The importer copes with hand-made layouts, including two-row headers and split "PO No. | Date" columns. Nothing is written until someone checks a preview of each sheet: rows found, columns ignored and rows skipped. The original file is kept as the revision record, and a spelling corrected once is remembered for the next import. From then on, departments update the BOM in the app instead of passing the spreadsheet around.',
  ] },
  'Plate-to-part traceability': { id: 'plate-traceability', heading: 'Material traceability from test certificate to finished part', body: [
    'Each mill test certificate is identified by certificate, cast and plate number together. The heat number and certificate are recorded once, when a plate is received, and every piece cut from it inherits them, so nobody re-types them at the cutting table.',
    'When a plate is cut, every used piece, usable remnant and scrap piece is chained to the plate it came from, with weights derived from its dimensions. Remnants go back into stock as real pieces with sizes, and when a BOM is released a fitting remnant is reserved before new plate is bought. The owner sees how much steel was reused.',
  ] },
  'Customer portal and nameplate QR': { id: 'customer-portal', heading: 'Customer portal and nameplate QR sticker', body: [
    'Each customer gets a read-only portal: every order as a stepper from order received to commissioning, overall progress, estimated dispatch, and the QC certificates and packing lists filed under the stage they belong to. After commissioning, service visits appear there too. A customer only ever sees their own orders.',
    'A 70 x 40 mm QR sticker for the boiler nameplate is printed from the project, one per unit when an order covers several boilers. Scanning it opens that order in the portal after the customer signs in, so plant staff can find documents and service history from the boiler itself.',
  ] },
  'Accounts built in': { id: 'accounts', heading: 'GST, TDS and the general ledger in the same system', body: [
    'The system is the book of record for each company entity: ledger, GSTR-1 and GSTR-3B, input-tax-credit reconciliation, TDS, reverse charge, fixed assets, bank reconciliation, financial statements, a books lock and an audit log.',
    'GST, TDS and income-tax rates are not typed in per company; they come from a central registry where each change is checked against the official notification and approved by a person before it goes live. Tally can still be kept in sync for an outside accountant, as an option rather than a requirement.',
  ] },
  'Alerts that reach the right person': { id: 'alerts', heading: 'Alerts each person chooses, and a morning brief for the owner', body: [
    'Every alert in the system is grouped by department, and each person chooses, alert by alert, whether it shows in the bell, arrives by email straight away, comes in a daily email, or stays off. Alerts meant for department heads only ever reach heads.',
    'The owner can also get a morning brief by email once a day: how many projects are on track, at risk or late, the ones slipping most, dispatches due this week, money outstanding and approvals waiting. Heads get a brief about their own team\'s work. It is written straight from the data, with no AI involved.',
  ] },
  'WhatsApp for quotations and RFQs': { id: 'whatsapp', heading: 'Send quotations and RFQs on WhatsApp', body: [
    'A quotation goes to the customer, and a request for quotation goes to suppliers, on WhatsApp in one click. Messages are sent from the company\'s own number through WhatsApp\'s official Cloud API, with no middleman, and a click-to-send link is the fallback when the number is not connected.',
    'Incoming WhatsApp conversations land in the sales enquiries inbox, linked to the lead or customer, and an alert goes to the person who owns them.',
  ] },
  'Owner view': { id: 'owner-view', heading: 'One page for the owner', body: [
    'The executive view puts every project\'s milestone status (on track, at risk or late) next to cash outstanding by customer, approvals waiting on the owner and this month\'s numbers, including how much steel was reused from remnants.',
    'Each figure comes from the same records the departments work in, so it is current without anyone preparing a report.',
  ] },
  'Device and data security': { id: 'device-security', heading: 'Stop drawings leaving the office on a USB drive', body: [
    'A small agent on office PCs keeps USB drives, CDs and DVDs, phones and chosen websites blocked by default. When an employee tries to use one, a request is filed; a manager approves it with a one-time code, and access opens for a short window, 15 minutes by default.',
    'Every request, approval and expiry is written to an audit log, so the owner can see who opened what, when, and who allowed it.',
  ] },
  'CRM to cash': { id: 'crm-to-cash', heading: 'From IndiaMART lead to payment received', body: [
    'Leads from IndiaMART, TradeIndia, JustDial and the company website arrive as enquiries in Sales automatically, assigned to salespeople in turn, with the source recorded. The same lead arriving twice is skipped, and a new enquiry from a known phone number is added to that customer\'s history.',
    'Enquiries move through funnel stages with a follow-up diary, quotations are priced from the company\'s price lists, and a won quotation becomes a sale order and a project. Payments are tracked against each order by stage, so collections are visible from the first call to the last instalment.',
  ] },
};

// US build (boiler-erp-us): the same capabilities in US terms. ASME paperwork instead of IBR, sales tax instead of
// GST/TDS, US lead sources only. Titles not listed here keep the text above.
const US_TEXT = {
  'IBR folder in one click': ['ASME record package in one click', "Manufacturer's Data Report (P-2 or U-1A), weld map, WPS/PQR, welder continuity, MTRs, NDE, PWHT and hydro test, from what is already linked to each part.",
    { id: 'asme-package', heading: 'ASME record package generated from the job', body: [
      "The Manufacturer's Data Report (Form P-2 for a firetube boiler under Section I, Form U-1A for a Section VIII Div. 1 vessel) is filled in from the job's own records instead of being typed for every unit, with the shop and inspection certificates for the Authorized Inspector to sign.",
      'Behind it come the records an inspector asks for: a weld map with each seam, its WPS and PQR and the stamps of the welders who made it; welder continuity under QW-322, six months per process, with the lapse date for each; mill test reports by heat number traced to the parts made from them; NDE reports; postweld heat treatment or the exemption that applies; and the hydrostatic test. Matching a mill test report to the part it covers is suggested, then confirmed by a person.',
    ] }],
  'Accounts built in': ['Accounts built in', 'Sales tax, ledger, bank reconciliation and financial statements for each company, with invoices, bills and payments sent to QuickBooks Online.',
    { id: 'accounts', heading: 'Sales tax and the general ledger in the same system', body: [
      'The system is the book of record for each company entity: ledger, receivables and payables, sales tax on invoices, fixed assets, bank reconciliation, financial statements, a books lock and an audit log. The books run on the calendar year.',
      'Sales tax is set per line, so an in-state customer is charged the local rate and an out-of-state or exempt customer is not.',
      "If the accountant works in QuickBooks Online, connect it once and map the accounts (suggested matches are filled in). From then on every issued invoice, approved supplier bill and payment goes to QuickBooks with its customer or vendor, and each one shows whether it is in QuickBooks; anything QuickBooks refuses is listed with the reason and a Retry. QuickBooks works out the sales tax itself, and its total is shown next to ours.",
    ] }],
  'WhatsApp for quotations and RFQs': ['Estimates and RFQs by message', 'Send estimates to customers and RFQs to suppliers in one click.',
    { id: 'whatsapp', heading: 'Send estimates and RFQs by message', body: [
      'An estimate goes to the customer, and a request for quote goes to suppliers, by WhatsApp or email in one click. Messages go from the company\'s own number through WhatsApp\'s official Cloud API, and a click-to-send link is the fallback when the number is not connected.',
      'Incoming conversations land in the sales inquiries inbox, linked to the lead or customer, and an alert goes to the person who owns them.',
    ] }],
  'CRM to cash': ['CRM to cash', 'Leads from your website and email become inquiries, estimates, orders and payments.',
    { id: 'crm-to-cash', heading: 'From website lead to payment received', body: [
      'Leads from the company website and email arrive as inquiries in Sales, assigned to salespeople in turn, with the source recorded. The same lead arriving twice is skipped, and a new inquiry from a known contact is added to that customer\'s history.',
      'Inquiries move through funnel stages with a follow-up diary, estimates are priced from the company\'s price lists, and a won estimate becomes a sales order and a job. Payments are tracked against each order by stage, from deposit to the last payment.',
    ] }],
  'Customer portal and nameplate QR': [null, null, { id: 'customer-portal', heading: 'Customer portal and nameplate QR sticker', body: [
    'Each customer gets a read-only portal: every order as a stepper from order received to startup, overall progress, estimated ship date, and the quality records and packing lists filed under the stage they belong to. After startup, service visits appear there too. A customer only ever sees their own orders.',
    'A 2.75 x 1.5 in QR sticker for the boiler nameplate is printed from the job, one per unit when an order covers several boilers. Scanning it opens that order in the portal after the customer signs in, so plant staff can find documents and service history from the boiler itself.',
  ] }],
};
const usTitle = t => US_TEXT[t]?.[0] || t;
export const FEATURES = IS_US ? IN_FEATURES.map(([icon, t, d]) => [icon, usTitle(t), US_TEXT[t]?.[1] || d]) : IN_FEATURES;
export const INTEGRATIONS = IS_US
  ? [['QuickBooks Online', null], ...IN_INTEGRATIONS.filter(([n]) => !['IndiaMART', 'TradeIndia', 'JustDial'].includes(n))]
  : IN_INTEGRATIONS;
export const FEATURE_DETAILS = IS_US
  ? Object.fromEntries(Object.entries(IN_FEATURE_DETAILS).map(([t, v]) => [usTitle(t), US_TEXT[t]?.[2] || v]))
  : IN_FEATURE_DETAILS;
