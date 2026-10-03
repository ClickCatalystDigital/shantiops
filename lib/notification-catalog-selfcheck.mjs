// node lib/notification-catalog-selfcheck.mjs
import assert from 'node:assert';
import { ALERT_GROUPS, visibleGroups, prefKey, resolvePref, OTHER_KIND } from './notification-catalog.mjs';

const kinds = ALERT_GROUPS.flatMap(g => g.alerts.map(a => a.kind));
assert.strictEqual(new Set(kinds).size, kinds.length, 'no alert kind listed twice');

const member = visibleGroups({ departments: ['QC'] });
assert.deepStrictEqual(member.map(g => g.key), ['General', 'QC'], 'member sees General + own department');
assert.ok(!member.find(g => g.key === 'QC').alerts.some(a => a.kind === 'inward_approval_pending'), 'member does not see a Heads-only alert');
const head = visibleGroups({ departments: ['QC'], isHeadOf: d => d === 'QC' });
assert.ok(head.find(g => g.key === 'QC').alerts.some(a => a.kind === 'inward_approval_pending'), 'head sees it');
const pm = visibleGroups({ isPm: true });
assert.ok(pm.some(g => g.key === 'PM') && pm.some(g => g.key === 'Sales'), 'PM sees Management and every department');
assert.ok(!visibleGroups({ departments: ['QC'] }).some(g => g.key === 'PM'), 'non-PM never sees Management');

assert.strictEqual(prefKey('qc_fail'), 'qc_fail');
assert.strictEqual(prefKey('something_new'), OTHER_KIND, 'unknown kinds use the Everything else row');
assert.deepStrictEqual(resolvePref(null), { in_app: true, email: 'off' }, 'default: bell on, email off');
assert.deepStrictEqual(resolvePref({ in_app: 0, email: 'daily' }), { in_app: false, email: 'daily' });
console.log('lib/notification-catalog.mjs self-check: all assertions passed.');
