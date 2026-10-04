import assert from 'node:assert/strict';
import { docLabel, finalizeDoc } from './installation-report-template.mjs';
import { setCompanies } from './company-profiles.js';
import { CUSTOMER_SEED } from './customer-seed.js';
setCompanies(CUSTOMER_SEED.companies); // fixture: the app fills this from company_settings
assert.deepEqual(finalizeDoc({ call_type: 'Commissioning' }, 7), { doc_no: 'SB-COM-007', revision: 0 });
assert.deepEqual(finalizeDoc({ call_type: 'Commissioning', doc_no: 'SB-COM-007', revision: 0 }, 9), { doc_no: 'SB-COM-007', revision: 1 });
assert.deepEqual(finalizeDoc({ call_type: 'Breakdown' }, 9), {});
assert.equal(docLabel({ doc_no: 'SB-COM-001', revision: 1 }), 'SB-COM-001 · Rev 01');
assert.equal(docLabel({}), null);
console.log('installation-report-doc selfcheck ok');
