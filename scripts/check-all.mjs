// Runs every self-check that needs no database (CI runs this before any deploy): lib/*selfcheck*.mjs,
// lib/*.test.mjs (node --test) and scripts/*selfcheck*.mjs. A self-check that reads a live database
// goes in NEEDS_DB; a new self-check file is picked up automatically.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const NEEDS_DB = new Set(['scripts/bom-item-guard-selfcheck.mjs', 'scripts/test-certificate-guard-selfcheck.mjs']);
const files = ['lib', 'scripts'].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`))
  .filter((f) => f !== 'scripts/check-all.mjs' && /selfcheck.*\.mjs$|^lib\/.*\.test\.mjs$/.test(f) && !NEEDS_DB.has(f)).sort();
const env = { ...process.env, TURSO_URL: '', NODE_NO_WARNINGS: '1' };
const failed = [];
for (const f of files) {
  const args = f.endsWith('.test.mjs') ? ['--test', f] : [f];
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { failed.push(f); console.log(`FAIL ${f}\n${(r.stdout + r.stderr).trim().split('\n').slice(-15).join('\n')}`); }
}
console.log(`self-checks: ${files.length - failed.length}/${files.length} passed`);
process.exit(failed.length ? 1 : 0);
