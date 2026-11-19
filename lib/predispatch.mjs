// Pre-dispatch sign-off: QC and Production always; Accounts too wherever the Accounts department is in use
// (it confirms the payment agreed with the customer has come in). Pure: used by the decide route, the
// review screens and their selfcheck (node lib/predispatch-selfcheck.mjs).
import { isDepartmentEnabled } from './manager-scope.mjs';

export const accountsSignOff = () => isDepartmentEnabled('Accounts');

// The reviewer slots this cycle needs, in screen order.
export const predispatchRoles = (needsAccounts = accountsSignOff()) => ['qc', 'production', ...(needsAccounts ? ['accounts'] : [])];

// rejected if any slot rejected; approved once every required slot approved; else pending.
export function overallStatus(row, needsAccounts = accountsSignOff()) {
  const roles = predispatchRoles(needsAccounts);
  if (roles.some(r => row[`${r}_decision`] === 'rejected')) return 'rejected';
  if (roles.every(r => row[`${r}_decision`] === 'approved')) return 'approved';
  return 'pending';
}

// What the customer owes against the linked invoice: total, received so far, balance.
export function paymentSummary(total, received) {
  const t = Number(total) || 0, r = Number(received) || 0;
  return { total: t, received: r, balance: Math.round((t - r) * 100) / 100 };
}

// GST: an e-way bill is needed for a consignment above ₹50,000 (Rule 138, CGST Rules).
export const EWAY_THRESHOLD = 50000;
export const needsEwayBill = invoiceTotal => (Number(invoiceTotal) || 0) > EWAY_THRESHOLD;
