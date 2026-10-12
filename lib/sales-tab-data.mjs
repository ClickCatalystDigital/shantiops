// Which data lists each Sales tab needs (app/sales/page.js loads only these for the open tab;
// SalesWorkspace shows "Loading" until they arrive after a tab switch). Small lists (branches,
// stages, users, saved views) are always loaded. Must match the props each panel receives in
// components/SalesWorkspace.jsx. A tab not listed needs none of the large lists.
export const SALES_TAB_DATA = {
  leads: ['leads', 'salesProducts'],
  quotations: ['quotations', 'salesProducts'],
  price_lists: ['priceLists', 'salesProducts'],
  sale_orders: ['saleOrders', 'salePayments', 'salesProducts'],
  invoices: ['invoices', 'creditNotes'],
  payment_orders: ['saleOrders', 'salePayments', 'invoices'],
  payment_log: ['saleOrders', 'salePayments', 'invoices'],
  trade_requests: ['tradeRequests'],
  returns: ['returns', 'saleOrders', 'inventoryItems'],
  products: ['salesProducts'],
  targets: ['salesTargets'],
};

// URL word (sale-orders) or key (sale_orders) -> key; unknown or missing -> the default tab.
export function salesTabKey(tab) {
  const k = String(tab || '').replace(/-/g, '_');
  return k || 'leads';
}

// A Sales member's visibility (lib/sales-visibility.mjs scopeSalesLists) of a list depends on
// earlier lists in this chain, so the server loads those too (it does not send them).
const SCOPE_DEPS = {
  quotations: ['leads'], saleOrders: ['leads'],
  invoices: ['leads', 'quotations', 'saleOrders'],
  creditNotes: ['leads', 'quotations', 'saleOrders', 'invoices'],
  salePayments: ['leads', 'saleOrders'],
};
export function keysToLoad(sendKeys, scoped) {
  const all = new Set(sendKeys);
  if (scoped) for (const k of sendKeys) for (const d of SCOPE_DEPS[k] || []) all.add(d);
  return all;
}

