// Load a calc set (lib/calc-sets/<key>.json: formulas, labelled inputs with sample values, checks) into a database.
// Idempotent; run the database's migrate first (scripts/migrate-db.mjs) so calc_input_defs exists.
//   TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/load-calc-set.mjs ibr-1950-shell-boiler
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadCalcSet } from '../lib/calc-set.mjs';

const key = process.argv[2];
if (!key || !process.env.TURSO_URL) throw new Error('usage: TURSO_URL=... node scripts/load-calc-set.mjs <set key>');
const set = JSON.parse(readFileSync(new URL(`../lib/calc-sets/${key}.json`, import.meta.url), 'utf8'));
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, intMode: 'number' });
const summary = await loadCalcSet({
  run: (sql, args = []) => db.execute({ sql, args }),
  get: async (sql, args = []) => (await db.execute({ sql, args })).rows[0],
}, set, { by: 'scripts/load-calc-set.mjs' });
console.log(`${set.key}:`, summary);
