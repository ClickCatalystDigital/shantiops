// lib/uom.js — the shared UoM preset list for supplier_quotes.uom (the one real human-entry point;
// po_items.uom/vendor_bill_items.uom both copy it through unedited, never separately typed). Pure
// data, no framework import, so both the authenticated ProcurementWorkspace.jsx and the public,
// unauthenticated RfqPortalForm.jsx can import it cheaply — same "extracted so the public portal
// doesn't have to pull in the whole authenticated bundle" precedent PaymentTermsField.jsx already
// set. Never a rigid enum: every caller uses this via SearchableSelect's free-text hybrid mode, so
// a real unit this short list doesn't anticipate can still be typed.
export const UOM_PRESETS = ['Nos', 'Kg', 'Mtr', 'Sqm', 'Set', 'Ltr'].map(u => ({ value: u, label: u }));
