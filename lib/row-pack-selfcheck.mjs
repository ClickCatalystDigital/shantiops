// node lib/row-pack-selfcheck.mjs
import { packRows, unpackRows } from './row-pack.mjs';
const rows = [{ a: 1, b: null, c: { x: 2 } }, { a: 0, b: 'y', c: null }];
const back = unpackRows(JSON.parse(JSON.stringify(packRows(rows))));
if (JSON.stringify(back) !== JSON.stringify(rows)) throw new Error('row-pack round trip');
if (unpackRows([]).length !== 0 || unpackRows(undefined).length !== 0) throw new Error('row-pack passthrough');
console.log('row-pack ok');
