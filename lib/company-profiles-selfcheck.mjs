// node lib/company-profiles-selfcheck.mjs — the seeded companies must print exactly what the old
// hardcoded COMPANY_PROFILES / qc-entities printed.
import assert from 'node:assert';
import { CUSTOMER_SEED } from './customer-seed.js';
import { setCompanies, companyProfile, COMPANY_NAMES, defaultCompany } from './company-profiles.js';

setCompanies(CUSTOMER_SEED.companies);
assert.deepStrictEqual([...COMPANY_NAMES], ['Shanti Boilers', 'Shanti Techno Fab', 'Srivaari Agencies']);
assert.equal(defaultCompany(), 'Shanti Boilers');

const sb = companyProfile('Shanti Boilers');
assert.equal(sb.name, 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD');
assert.equal(sb.sub, 'P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164');
assert.equal(sb.qc.name, 'Shanti Boilers & Pressure Vessels (P) Ltd');
assert.equal(sb.qc.address, '# P-10-10, IDA Nacharam, Hyderabad - 500076 Telangana, India.');
assert.equal(sb.qc.refPrefix, 'SB/QC/OW');
assert.deepStrictEqual(sb.qc.contact.emails, ['sales@shantiboilers.com', 'info@shantiboilers.com']);

const stf = companyProfile('Shanti Techno Fab');
assert.equal(stf.name, 'SHANTI TECHNO FAB PVT LTD');
assert.equal(stf.sub, 'Survey No. 128/E3, Kuncharam Village, Toopran Mandal, Medak, Telangana - 502336 · GST: 36AAVCS1802J1Z1');
assert.equal(stf.qc.name, 'Shanti Techno Fab Pvt Ltd');
assert.equal(stf.qc.address, 'Kucharam, Hyderabad');
assert.equal(stf.qc.refPrefix, 'STF/QC/OW');

const sa = companyProfile('Srivaari Agencies');
assert.equal(sa.name, 'SRIVAARI AGENCIES');
assert.equal(sa.sub, 'Hyderabad, Telangana');

// Unknown / blank company falls back to the default company, as before.
assert.equal(companyProfile('Nope').name, sb.name);
assert.equal(companyProfile(null).name, sb.name);
// Empty cache never throws.
setCompanies([]);
assert.equal(companyProfile('X').name, 'X');
console.log('company-profiles selfcheck ok');
