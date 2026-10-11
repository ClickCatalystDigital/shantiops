// Fails if any text in the demo database mentions the real customer. Run before publishing a golden DB.
//   DB_URL=... DB_TOKEN=... node scripts/demo/scrub-check.mjs
import { createClient } from '@libsql/client';

const DENY = ['shanti', 'srivaari', '36AAECS7382N1ZN', '36AAVCS1802J1Z1', 'AAECS7382N', 'AAVCS1802J', 'nacharam', 'kucharam',
  'toopran', 'HKM', 'asian brown', 'virchow', 'jaganmohan', 'shantiboilers', 'SB-1', 'STF-IBR', 'telangana, hyderabad'];
const db = createClient({ url: process.env.DB_URL, authToken: process.env.DB_TOKEN, intMode: 'number' });
const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(r => r.name);
let hits = 0;
for (const t of tables) {
  const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows.filter(c => /TEXT|CHAR|^$/i.test(c.type)).map(c => c.name);
  for (const c of cols) {
    for (const w of DENY) {
      const r = await db.execute({ sql: `SELECT COUNT(*) n, MIN(substr("${c}",1,80)) ex FROM "${t}" WHERE "${c}" LIKE ?`, args: [`%${w}%`] });
      if (r.rows[0].n) { hits += r.rows[0].n; console.log(`${t}.${c} ~ "${w}": ${r.rows[0].n} (e.g. ${r.rows[0].ex})`); }
    }
  }
}
console.log(`${tables.length} tables scanned, ${hits} hit(s)`);
process.exit(hits ? 1 : 0);
