// Lightweight, dependency-free lint baseline for this repo. Next's interactive ESLint setup is
// not suitable for CI or a free-tier deploy, so this validates every plain JS/MJS/JSX file without
// changing the project's existing runtime or requiring a network install.
//
// Files are parsed with @babel/parser (already present transitively via Next's own @babel/core, not a
// new dependency).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';

const roots = ['app', 'components', 'hooks', 'lib', 'scripts', 'server', 'middleware.js', 'next.config.js', 'postcss.config.js'];
const files = [];

function walk(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    if (/\.(js|mjs|jsx)$/.test(path)) files.push(path);
    return;
  }
  for (const entry of readdirSync(path)) walk(resolve(path, entry));
}

for (const root of roots) walk(resolve(root));
let failed = 0;
// Every file goes through @babel/parser. `node --check` was used for .js/.mjs, but Node 23 silently passes
// any file that contains an import (its ES-module detection skips the check), which is nearly every file here.
for (const file of files) {
  try { parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'topLevelAwait'], errorRecovery: false }); }
  catch (error) { failed++; process.stderr.write(`syntax error: ${file}\n${error.message}\n`); }
}
if (failed) process.exit(1);
console.log(`syntax check passed: ${files.length} JavaScript files`);
