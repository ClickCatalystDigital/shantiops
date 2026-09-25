import assert from 'node:assert/strict';
import { warrantyWindow as w } from './installed-base.mjs';
const T = '2026-09-25';
assert.equal(w({}, {}, T).status, 'none');
assert.equal(w({ warranty_std_days: 365 }, {}, T).status, 'not_started');
const a = w({ warranty_std_days: 365, warranty_accepted_days: 30, from_date_of: 'D' }, { deliveredOn: '2026-09-01 10:00:00' }, T);
assert.equal(a.days, 30); assert.equal(a.start, '2026-09-01'); assert.equal(a.end, '2026-10-01'); assert.equal(a.status, 'active'); assert.equal(a.daysLeft, 6);
assert.equal(w({ warranty_std_days: 10, from_date_of: 'I' }, { deliveredOn: '2026-01-01' }, T).status, 'not_started'); // needs installation
assert.equal(w({ warranty_std_days: 10, from_date_of: 'I' }, { installedOn: '2026-09-01' }, T).status, 'expired');
console.log('installed-base selfcheck ok');
