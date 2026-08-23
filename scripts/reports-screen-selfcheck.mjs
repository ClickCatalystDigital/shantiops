// scripts/reports-screen-selfcheck.mjs — node scripts/reports-screen-selfcheck.mjs
// Guards the "catalog entry with no ReportsWorkspace SCREEN entry" bug that's bitten this codebase
// twice (Accounts Fixed Assets, then all 7 Dispatch/QC reports): adding a report to
// lib/reports/catalog.js gives it a working compute()+PDF automatically, but the on-screen card
// needs a SEPARATE manual SCREEN-map entry — nothing enforces the two stay in sync.
//
// Text-scans both source files rather than importing them: lib/reports/catalog.js transitively
// pulls in DB clients (needs TURSO_URL), and ReportsWorkspace.jsx is JSX a plain node script can't
// parse — regex sidesteps both, no env/build step needed.
import { readFileSync } from 'fs';
import { strict as assert } from 'node:assert';

const catalogSrc = readFileSync(new URL('../lib/reports/catalog.js', import.meta.url), 'utf8');
const workspaceSrc = readFileSync(new URL('../components/ReportsWorkspace.jsx', import.meta.url), 'utf8');

const catalogKeys = [...catalogSrc.matchAll(/^\s*key:\s*'([^']+)'/gm)].map(m => m[1]);
assert.ok(catalogKeys.length > 30, `sanity check: catalog scan found only ${catalogKeys.length} reports — regex probably broke`);

const screenBlock = workspaceSrc.match(/export const SCREEN = \{([\s\S]*?)\n\};/)[1];
const screenKeys = [...screenBlock.matchAll(/'([^']+)':\s*\w+/g)].map(m => m[1]);

const missing = catalogKeys.filter(k => !screenKeys.includes(k));
assert.deepEqual(missing, [], `Reports missing a ReportsWorkspace SCREEN entry: ${missing.join(', ')}`);

console.log(`OK — ${catalogKeys.length} catalog reports all have a SCREEN entry.`);
