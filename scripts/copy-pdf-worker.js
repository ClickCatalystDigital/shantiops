// Copies the PDF.js worker into public/ as a plain static asset so Next's webpack build never
// touches it — its production Terser pass doesn't recognize the copied file as an ES module
// ('import'/'export' cannot be used outside module code), because it was built by asset-module
// bundling (`new URL(...)`) instead of just served raw. Runs on every `npm install` so the file
// always matches whatever pdfjs-dist version is actually installed.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs');
const dest = path.join(__dirname, '..', 'public', 'pdf.worker.min.mjs');

fs.copyFileSync(src, dest);
console.log('Copied pdf.worker.min.mjs to public/');
