// node lib/qc-paste-selfcheck.mjs
import { parsePaste } from './qc-paste.mjs';

const assert = (c, m) => { if (!c) throw new Error(m); };
const a = parsePaste('Part No\tPart name\tT\tW\tL\tQty\n1\tShell belt\t16\t2500\t6000\t1\n2\tEnd plate\t20\n\t\t5', 'parts');
assert(a.rows.length === 2, 'heading skipped, blank-name row skipped');
assert(a.rows[0].part_name === 'Shell belt' && a.rows[0].size_l === '6000', 'columns in order');
assert(a.rows[1].size_w === null && a.rows[1].qty === null, 'short row padded with null');
assert(a.skipped.length === 1, 'blank name reported');
const b = parsePaste('Safety valve\t50 NB\tCS\tAcme\t2\tSV1, SV2', 'mountings');
assert(b.rows.length === 1 && b.rows[0].serial_numbers === 'SV1, SV2', 'no heading, all columns');
const c = parsePaste('10\tTube\t3.2', 'parts');
assert(c.rows.length === 1 && c.rows[0].part_no === '10', 'numeric first row is data');
console.log('qc-paste ok');
