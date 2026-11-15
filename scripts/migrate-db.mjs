// Brings one database's schema up to the current code (the same migrate() the app runs on start),
// so CI can update databases the app itself never migrates: the demo's golden and live copies run
// with SKIP_MIGRATE=1 on Workers. Skips when the stored fingerprint already matches.
//   TURSO_URL=... TURSO_AUTH_TOKEN=... CUSTOMER_SEED='{...}' node scripts/migrate-db.mjs
// CUSTOMER_SEED must be the deployment's own seed: on a database that is missing rows, migrate()
// seeds from it (unset = the original customer's sample data).
// In GitHub Actions it writes changed=true|false to $GITHUB_OUTPUT (the demo's data scan runs only
// when the golden database was changed).
import { appendFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { MIGRATE_CODE_FINGERPRINT } from '../lib/migrate-fingerprint.generated.js';

if (!process.env.TURSO_URL) throw new Error('TURSO_URL is required');
process.env.NODE_ENV = 'production';
delete process.env.SKIP_MIGRATE;
const t = Date.now();
const probe = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const before = await probe.execute("SELECT value FROM app_settings WHERE key = 'schema_fingerprint'")
  .then((r) => r.rows[0]?.value ?? null).catch(() => null);
// Without CUSTOMER_SEED, migrate() fills missing rows with the original customer's companies and sample data.
// A public demo database (it has demo_meta) must never get those: refuse instead of leaking them.
const isDemo = await probe.execute("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'").then((r) => r.rows.length > 0).catch(() => false);
if (isDemo && !process.env.CUSTOMER_SEED) {
  console.error('migrate-db: this is a demo database; set CUSTOMER_SEED="$(cat scripts/demo/acme-seed.json)"');
  process.exit(1);
}
probe.close();
const changed = before !== MIGRATE_CODE_FINGERPRINT;
if (changed) {
  const { initDB } = await import('../lib/db.js');
  await initDB();
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
console.log(`migrate-db: ${new URL(process.env.TURSO_URL).hostname || 'file'} ${changed ? 'migrated to' : 'already at'} ${MIGRATE_CODE_FINGERPRINT} (${Date.now() - t} ms)`);
process.exit(0);
