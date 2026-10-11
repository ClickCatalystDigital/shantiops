// Demo branch: OpenNext rewrites .wasm imports to absolute paths, but wrangler's module collector joins
// every wasm specifier onto the importer's directory, so an absolute path ends up doubled. Make them
// relative to the handler (which sits in that same directory). Run after `opennextjs-cloudflare build`.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('.open-next/server-functions/default');
const file = `${dir}/handler.mjs`;
const src = readFileSync(file, 'utf8');
const out = src.split(`${dir}/`).join('./');
writeFileSync(file, out);
// yoga.wasm is created by patch-yoga.mjs after Next's file tracing, so OpenNext never copied it.
const wasm = 'node_modules/yoga-layout/dist/binaries/yoga.wasm';
copyFileSync(`.next/standalone/${wasm}`, `${dir}/${wasm}`);
console.log(`relative wasm imports: ${(src.length - out.length) / (dir.length - 1)} rewritten`);
