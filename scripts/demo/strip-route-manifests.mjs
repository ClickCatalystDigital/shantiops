// Demo branch (Cloudflare Workers): route handlers carry a client-reference manifest Next loads with
// handleMissing: true and never uses (they render no React). ~350 of them at ~77 KB each pushed the
// Worker to the 10 MB limit, so drop them between `next build` and the OpenNext bundle step.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

let n = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f === 'route_client-reference-manifest.js') { rmSync(p); n++; }
  }
}
for (const d of ['.next/server/app', '.next/standalone/.next/server/app']) { try { walk(d); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
console.log(`removed ${n} route manifests`);
