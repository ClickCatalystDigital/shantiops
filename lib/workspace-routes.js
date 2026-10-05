// Workspaces whose sidebar tabs each have their own address: /stores/inventory, /sales/quotations...
// One list, used by next.config.js (rewrites /base/<tab> to /base?tab=<tab>), by the shared sidebar
// (components/WorkspaceSidebar.jsx, which keeps the address in step with the open tab) and by the
// top bar (so /stores/inventory still highlights Stores). CommonJS so next.config.js can require it.
// Not listed on purpose: /projects, /calc, /reports, /help (they have real sub-pages or their own scheme).
const TAB_BASES = ['/sales', '/market', '/procurement', '/stores', '/pr', '/production/shop', '/planning', '/qc', '/dispatch', '/installation', '/service-expenses', '/hr', '/accounts', '/engineering', '/approvals'];

// Tab key -> the word in the address (sale_orders -> sale-orders).
const tabSlug = key => String(key).replace(/_/g, '-');
// The base a path belongs to, or null. '/stores/inventory' -> '/stores'.
const tabBase = pathname => TAB_BASES.find(b => pathname === b || pathname.startsWith(`${b}/`)) || null;

module.exports = { TAB_BASES, tabSlug, tabBase };
