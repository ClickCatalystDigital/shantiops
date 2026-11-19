// What a customer payment is for. Boilers in India are usually sold on staged terms, e.g. 30% advance
// with the PO, 60% before dispatch, 10% after commissioning (or 50/50). Blank = not said (older rows).
export const PAYMENT_TYPES = [
  ['advance', 'Advance'],
  ['before_dispatch', 'Before dispatch'],
  ['after_delivery', 'After delivery'],
  ['after_commissioning', 'After commissioning'],
  ['retention', 'Retention'],
];
export const paymentTypeLabel = v => PAYMENT_TYPES.find(([k]) => k === v)?.[1] || null;
export const isPaymentType = v => PAYMENT_TYPES.some(([k]) => k === v);
