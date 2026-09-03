// lib/eway-bill.js — the one place e-way-bill generation is dispatched from. Direct-to-NIC only,
// deliberately (no GSP/provider): the government's own registration is portal-based (the taxpayer
// logs into the E-Way Bill portal themselves, Registration -> For API, and NIC issues Client ID /
// Client Secret / API Username / API Password) and cannot be automated by this app — the user does
// that step externally, then enters the resulting credentials in Accounts -> Company Entities.
//
// No real NIC account exists yet to build/test the actual call against, so this throws a clear
// "not wired yet" error rather than faking success — same seam shape as lib/mail.js. To wire the
// real call once credentials exist: implement the NIC auth + generate-e-way-bill calls here. No
// other file needs to change — every caller already goes through generateEwayBill().
export async function generateEwayBill({ company, credentials, payload }) {
  if (!credentials) {
    throw new Error(`No e-way-bill credentials configured for ${company} — register on the E-Way Bill portal (Registration -> For API), then add the credentials in Accounts -> Company Entities.`);
  }
  throw new Error('lib/eway-bill.js: NIC API call not implemented yet — credentials are stored, generation is not wired.');
}
