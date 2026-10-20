// Copies the live database into sb-ops-local.db, the file `npm run dev` uses (.env.development.local
// blanks TURSO_URL). Reads every row once (~120k today); run it when you want fresher local data, not
// on a timer. Usage: node --env-file=.env.local scripts/pull-live-db.mjs
import { createClient } from '@libsql/client';
import { existsSync, renameSync } from 'fs';

const url = process.env.TURSO_URL, token = process.env.TURSO_AUTH_TOKEN;
if (!url) { console.error('TURSO_URL not set; run with --env-file=.env.local'); process.exit(1); }
const res = await fetch(url.replace(/^libsql:/, 'https:') + '/dump', { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) { console.error('dump failed:', res.status, await res.text()); process.exit(1); }
const sql = await res.text();
const file = 'sb-ops-local.db', tmp = file + '.new';
for (const f of [tmp, tmp + '-journal']) if (existsSync(f)) renameSync(f, f + '.old');
await createClient({ url: 'file:' + tmp }).executeMultiple(sql);
if (existsSync(file)) renameSync(file, file + '.bak');
renameSync(tmp, file);
console.log(`${file} refreshed (${(sql.length / 1e6).toFixed(1)} MB dump); previous copy kept as ${file}.bak`);
