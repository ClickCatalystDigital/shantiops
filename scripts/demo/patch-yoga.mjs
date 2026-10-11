// Demo branch (Cloudflare Workers): Workers forbids compiling WebAssembly from bytes at runtime, which
// is how yoga-layout (react-pdf's layout engine) loads its embedded base64 wasm. Extract the wasm to
// a real file and hand the precompiled module to Emscripten's `instantiateWasm` hook instead; wrangler
// bundles `import x from './yoga.wasm'` as a CompiledWasm module. Idempotent; run before the OpenNext build.
import { readFileSync, writeFileSync } from 'node:fs';

// Patches the copy OpenNext bundles from (.next/standalone), never the project's own node_modules:
// `next build` loads routes in plain Node, which can't import a .wasm file.
const dir = `${process.argv[2] || '.next/standalone'}/node_modules/yoga-layout/dist`;
const glue = readFileSync(`${dir}/binaries/yoga-wasm-base64-esm.js`, 'utf8');
const b64 = glue.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/)?.[1];
if (!b64) throw new Error('yoga-layout: embedded wasm not found (package layout changed?)');
writeFileSync(`${dir}/binaries/yoga.wasm`, Buffer.from(b64, 'base64'));

writeFileSync(`${dir}/src/load.js`, `// Patched by scripts/demo/patch-yoga.mjs (Workers: precompiled wasm module).
import loadYogaImpl from '../binaries/yoga-wasm-base64-esm.js';
import yogaWasm from '../binaries/yoga.wasm';
import wrapAssembly from "./wrapAssembly.js";
export async function loadYoga() {
  return wrapAssembly(await loadYogaImpl({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(yogaWasm, imports).then(instance => receiveInstance(instance, yogaWasm));
      return {};
    },
  }));
}
export * from "./generated/YGEnums.js";
`);
console.log(`yoga-layout patched (${Math.round(b64.length * 0.75 / 1024)} KB wasm)`);
