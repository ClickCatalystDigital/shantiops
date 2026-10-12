// Brings one database's schema up to the current code (the same migrate() the app runs on start),
// so CI can update databases the app itself never migrates: the demo's golden and live copies run
// with SKIP_MIGRATE=1 on Workers. Skips when the stored fingerprint already matches.
//   TURSO_URL=... TURSO_AUTH_TOKEN=... CUSTOMER_SEED='{...}' node scripts/migrate-db.mjs
// CUSTOMER_SEED must be the deployment's own seed: on a database that is missing rows, migrate()
// seeds from it (unset = the original customer's sample data).
if (!process.env.TURSO_URL) throw new Error('TURSO_URL is required');
process.env.NODE_ENV = 'production';
delete process.env.SKIP_MIGRATE;
const t = Date.now();
const { initDB, queryAll } = await import('../lib/db.js');
await initDB();
const [fp] = await queryAll("SELECT value FROM app_settings WHERE key = 'schema_fingerprint'");
console.log(`migrate-db: ${new URL(process.env.TURSO_URL).hostname || 'file'} at ${fp?.value} (${Date.now() - t} ms)`);
