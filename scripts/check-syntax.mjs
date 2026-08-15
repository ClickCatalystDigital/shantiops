// Lightweight, dependency-free lint baseline for this repo. Next's interactive ESLint setup is
// not suitable for CI or a free-tier deploy, so this validates every plain JS/MJS file without
// changing the project's existing runtime or requiring a network install.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const roots = ['app', 'components', 'hooks', 'lib', 'scripts', 'middleware.js', 'next.config.js', 'postcss.config.js'];
const files = [];

function walk(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    if (/\.(js|mjs)$/.test(path)) files.push(path);
    return;
  }
  for (const entry of readdirSync(path)) walk(resolve(path, entry));
}

for (const root of roots) walk(resolve(root));
let failed = 0;
for (const file of files) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { failed++; process.stderr.write(`syntax error: ${file}\n${error.stderr || ''}`); }
}
if (failed) process.exit(1);
console.log(`syntax check passed: ${files.length} JavaScript files`);
