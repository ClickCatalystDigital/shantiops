// Copy 3D models exported by ../items (sbops_export.py, sbops_assemblies.py) into public/models.
// ponytail: plain copy; move to a versioned R2 bucket once a second app uses these models.
import { cpSync, existsSync } from 'node:fs';
const src = process.argv[2] || '../items/exports/sbops';
const map = { 'IN/models': 'in', 'US/models': 'us', assemblies: 'assemblies' };
for (const [from, to] of Object.entries(map)) {
  const p = `${src}/${from}`;
  if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  cpSync(p, `public/models/${to}`, { recursive: true });
  console.log(`${p} -> public/models/${to}`);
}
