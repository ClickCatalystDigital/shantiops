// Product capabilities shown on the sign-in and demo pages: only things the product does today.
import { FileCheck2Icon, LayersIcon, QrCodeIcon, LandmarkIcon, BellIcon, UsersIcon, RecycleIcon, GaugeIcon, MessageCircleIcon, ShieldCheckIcon } from 'lucide-react';

export const FEATURES = [
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

// Outside services SB Ops connects to (names only; swap in logo files when available). Each is
// built: WhatsApp Cloud API, SMTP email (Zoho, Gmail, any provider), lead sources, AI assistant,
// Cloudflare R2 / S3-compatible file storage. (NIC e-way bill: add once it has run against NIC.)
export const INTEGRATIONS = ['WhatsApp', 'Email (Zoho, Gmail, any SMTP)', 'IndiaMART', 'TradeIndia', 'JustDial', 'Website forms', 'AI assistant', 'Cloud file storage'];
