// node lib/product-spec-selfcheck.mjs
import assert from 'node:assert/strict';
import { readProductSpec as r } from './product-spec.mjs';
const eq = (a, b) => assert.deepEqual(a, { series: null, capacity: null, pressure: null, design: null, ...b });
eq(r({ name: 'BOILER-SF-350-WB', type: 'SOLID-FLAME' }), { series: 'SF', capacity: 350, design: 'WB' });
eq(r({ name: 'BOILER-CF-400-15B-BH', type: 'COMBI-FLAME' }), { series: 'CF', capacity: 400, pressure: 15 });
eq(r({ name: 'BOILER-CF-400-12.5B', type: 'COMBI-FLAME' }), { series: 'CF', capacity: 400, pressure: 12.5 });
eq(r({ name: 'BOILER-AF-1 TPH', type: 'AGRO-FLAME' }), { series: 'AF', capacity: 1000 });
eq(r({ name: 'BOILER-AF- 2 TPH', type: 'AGRO FLAME' }), { series: 'AF', capacity: 2000 });
eq(r({ name: 'BOILER-MULTI-FLAME-400-BH', type: 'MULTI-FLAME' }), { series: 'MF', capacity: 400 });
eq(r({ name: 'BOILER-MF-150--17B', type: 'MULTI-FLAME' }), { series: 'MF', capacity: 150, pressure: 17 });
eq(r({ name: 'BOILER-SF-75-SWB-7B', type: 'SOLID-FLAME' }), { series: 'SF', capacity: 75, design: 'SWB', pressure: 7 });
eq(r({ name: 'SBH-OF-100-2S', type: 'OIL-FLAME' }), { series: 'OF', capacity: 100 });
eq(r({ name: 'BOILER-GF-100', type: 'GAS-FLAME' }), { series: 'GF', capacity: 100 });
eq(r({ name: 'BOILER-DF-200', type: 'GAS-FLAME' }), { series: 'DF', capacity: 200 });
eq(r({ name: 'BOILER-CF-350', type: 'SOLID-FLAME' }), {});           // type contradicts the code: nothing is trusted
eq(r({ name: 'BOILER-AF-DF-250-12.5B', type: 'GAS-FLAME' }), {});    // two series in one name
eq(r({ name: 'BOILER-SIB-SF-10' }), { series: 'SIB' });               // number not read
eq(r({ name: 'BOILER-CF-800-BUBBLING BED', type: 'COMBI-FLAME' }), { series: 'CF', capacity: 800 });
eq(r({ name: 'PRS-200-CI', type: 'PRS' }), { series: 'PRS' });
eq(r({ name: 'STRAIGHT CHIMNEY-250 DIA X 6 M', type: 'STRAIGHT CHIMNEY/STACK' }), {});
eq(r({ name: 'BOILER-SF-350-WB' }), { series: 'SF', capacity: 350, design: 'WB' }); // no type = name only
eq(r({}), {});
console.log('product-spec selfcheck: ok');
