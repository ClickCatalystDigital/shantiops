// Public demo: the sample logins a visitor can enter as (created by scripts/demo/seed-acme.mjs).
export const DEMO_ROLES = [
  { username: 'manager', label: 'Owner / Manager', blurb: 'Every department, executive dashboard, approvals' },
  { username: 'sales_head', label: 'Sales', blurb: 'Enquiries, quotations, sale orders, payments' },
  { username: 'design_head', label: 'Design', blurb: 'Drawings, calculation sheets, design sign-off' },
  { username: 'engg_head', label: 'Engineering', blurb: 'BOM tree, item master, release BOM' },
  { username: 'procurement_head', label: 'Procurement', blurb: 'RFQs, supplier quotes, purchase orders' },
  { username: 'stores_head', label: 'Stores', blurb: 'Receiving, inventory, allocation, issues' },
  { username: 'production_head', label: 'Production', blurb: 'Job cards, material indents, cutting' },
  { username: 'qc_head', label: 'Quality (QC)', blurb: 'Inspections, test certificates, IBR documents' },
  { username: 'dispatch_head', label: 'Dispatch', blurb: 'Packing lists, approvals, e-way bill, shipments' },
  { username: 'service_head', label: 'Service', blurb: 'Site visits, commissioning reports' },
  { username: 'accounts_head', label: 'Accounts', blurb: 'Ledger, GST returns, receivables, payables' },
  { username: 'hr_head', label: 'HR', blurb: 'Employees, attendance, payroll' },
];

// The Customer role is every customer with a portal login (a Sale Order creates one), picked on the demo page.
// Greenfield Foods (scripts/demo/add-shop-demo.mjs) is listed first.
export const DEFAULT_DEMO_CUSTOMER = 'greenfield_foods';
export const DEMO_CUSTOMERS_SQL = `SELECT u.username, COALESCE(c.name, u.display_name, u.username) AS name
  FROM users u LEFT JOIN customers c ON c.portal_user_id = u.id
  WHERE u.role = 'customer' AND u.active = 1 AND u.pending = 0
  ORDER BY u.username = '${DEFAULT_DEMO_CUSTOMER}' DESC, name`;
