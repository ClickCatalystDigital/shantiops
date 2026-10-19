// node lib/shop-catalog-selfcheck.mjs — the Shop's group map and description reader.
import assert from 'node:assert/strict';
import { shopGroupOf, shopItem, readShopSpec, cleanText, smartCase, addOnsFor, groupSummary, dedupeShopItems, HIDDEN, SHOP_GROUPS, SHOP_SECTIONS } from './shop-catalog.mjs';

const P = (product_type, product_name, description = '', unit = 'Set', product_code = null) => ({ id: Math.floor(Math.random() * 1e6), product_type, product_name, description, unit, product_code });

// every group belongs to a real section
for (const g of SHOP_GROUPS) assert.ok(SHOP_SECTIONS.some(s => s.key === g.section), g.key);

// map: equipment, spares, services, placeholders, misfiled rows, hidden, unknown
assert.equal(shopGroupOf(P('SOLID-FLAME', 'BOILER-SF-100')), 'solid-fuel');
assert.equal(shopGroupOf(P('SOLID FLAME', 'X')), 'solid-fuel');
assert.equal(shopGroupOf(P('MULTI-CYCLONE -CYCLONE', 'MDC')), 'cyclones');
assert.equal(shopGroupOf(P('SIB- SF-SERIES', 'BOILER-SIB')), 'sib');
assert.equal(shopGroupOf(P('THERMIC HEATER - GF', 'T')), 'thermic');
assert.equal(shopGroupOf(P('X1', 'PRESSURE SWITCH - RT-05')), 'mountings');
assert.equal(shopGroupOf(P('X2', 'SOLONOID VALVES')), 'valves');
assert.equal(shopGroupOf(P('X3', 'STEAM TRAP')), 'mountings');
assert.equal(shopGroupOf(P('XXX', 'BOILER-NON IBR-GF-80')), 'non-ibr-gas');
assert.equal(shopGroupOf(P('MISCELANIOUS', 'TURBULATORS')), 'castings');
assert.equal(shopGroupOf(P('BLOWERS', 'BEARING-22211k', '', 'Nos')), 'rotating');
assert.equal(shopGroupOf(P('COMBI-FLAME', 'AUTO FUEL FEEDING SYSTEM-CF-1000')), 'fuel-feeding');
assert.equal(shopGroupOf(P('GLOBE VALVE-#150-IBR', 'GV')), 'valves');
assert.equal(shopGroupOf(P('DUMMY FLANGE-CLASS 300-NONIBR', 'DF')), 'pipes');
assert.equal(shopGroupOf(P('LAISONING CHARGES ONLY', 'L')), 'services');
assert.equal(shopGroupOf(P('NON STANDARD OFFERS', 'CUSTOMIZED OFFER')), HIDDEN);
assert.equal(shopItem(P('OTHERS', 'OTHERS')), null);
assert.equal(shopGroupOf(P('SOMETHING NEW', 'X')), null);

// text cleaning
assert.equal(cleanText('A &#61692; B &amp; C'), 'A\n• B & C');
assert.equal(cleanText('All Boiler Miunted Valves'), 'All Boiler Mounted Valves');
assert.equal(smartCase('SAFETY VALVE, CI, IBR 25 NB'), 'Safety Valve, CI, IBR 25 NB');
assert.equal(smartCase('Already Mixed'), 'Already Mixed');

// boiler description
const sf = readShopSpec(P('SOLID-FLAME', 'BOILER-SF-200', 'Design , Engineering and Supply of 2 TPH 10.54 Bar Pressure Three Pass, Fully Wet Back Solid Fuel ( Coal / Wood / Biomass Briquetes) Fired Packaged Boiler having CONCENTRIC FURANCE &#61692; Steam Boiler ( Pressure Part) &#61692; All Boiler Miunted Valves &#61692; SS304 Boiler feed Pumps x 2 Nos REFER TECHNICAL OFFER FOR DETAILS // EXCLUSSIONS'));
assert.deepEqual(sf.capacity, { value: 2, unit: 'TPH', label: '2 TPH', kg: 2000 });
assert.equal(sf.pressure.value, 10.54);
assert.equal(sf.passes, '3');
assert.equal(sf.back, 'Fully wet back');
assert.ok(['Coal', 'Wood', 'Biomass', 'Briquettes', 'Solid fuel'].every(f => sf.fuels.includes(f)), sf.fuels.join());
assert.ok(sf.build.includes('Packaged') && sf.build.includes('Concentric furnace'));
assert.deepEqual(sf.includes, ['Steam Boiler ( Pressure Part)', 'All Boiler Mounted Valves', 'SS304 Boiler feed Pumps x 2 Nos']);

// kg/hour, gas, non-IBR coil
const coil = readShopSpec(P('COIL TYPE BOILER', 'X', 'Design Engineering and Supply of 150 Kgs / Hour Pressure 12 Kgs / Cm Sq Non-IBR Coil Type Gas ( LPG / CNG ) Fired Boiler'));
assert.equal(coil.capacity.kg, 150);
assert.equal(coil.pressure.value, 12);
assert.deepEqual(coil.fuels, ['LPG', 'CNG']);
assert.ok(coil.build.includes('Non-IBR') && coil.build.includes('Coil type'));

// thermic heat output, PRS flow and pressures, exclusions, chimney size, tank volume
assert.equal(readShopSpec(P('THERMIC HEATER - SF', 'T', 'Solid Fuel Fired Thermic Fluid Heater having a heat output of 10 Lac Kilo Calories')).capacity.label, '10 lakh kcal/hr');
const prs = readShopSpec(P('PRS', 'PRS-100', 'Pressure Regulating Station , Model SB-PRS-100 ; Flow : 1000 Kgs; Up Stream Pressure 10.5 Kgs cm Sq > Down Stream 3 Kgs Cm Sq ; EXCLUSSION - Site Visit, Site Installaion'));
assert.equal(prs.capacity.label, '1,000 kg/hr flow');
assert.equal(prs.pressure.label, '10.5 → 3 kg/cm²');
assert.deepEqual(prs.excludes, ['Site Visit', 'Site Installation']);
assert.equal(readShopSpec(P('SELF SUPPORTED CHIMNEY - 2D', 'C', 'Tapered Self Supported having Top Diameter of 1000 mm < 2000 mm x 30.5 Meters Height')).chimney, '1000 mm top dia · 30.5 m high');
assert.equal(readShopSpec(P('TANK ( Oil / Water )', 'T', 'Supply of 12 KL Over Head Tank')).capacity.label, '12 KL');

// nothing written -> nothing read
const empty = readShopSpec(P('XXX', 'BOILER-NON IBR-GF-80', null));
assert.equal(empty.capacity, null); assert.equal(empty.pressure, null); assert.deepEqual(empty.fuels, []); assert.deepEqual(empty.includes, []);
assert.equal(readShopSpec(P('SOLID-FLAME', 'B', 'Boiler 500 Kgs pressure part')).pressure, null);

// spares: material / IBR / rating / size / make
const sv = readShopSpec(P('SAFETY VALVE-CS-IBR', 'SAFETY VALVE,CI,F/E,IBR,40 NB, DOUBLE POST', 'SAFETY VALVES, DOUBLE POST MAKE: WJ/ATAM', 'Nos')).spare;
assert.equal(sv.ibr, 'IBR'); assert.equal(sv.material, 'Carbon steel'); assert.equal(sv.size, '40 NB'); assert.equal(sv.make, 'WJ/ATAM');
const gv = readShopSpec(P('GLOBE VALVE-#300-IBR', 'GLOBE VALVE 25 MM', '', 'Nos')).spare;
assert.equal(gv.rating, 'Class 300'); assert.equal(gv.size, '25 mm');
assert.equal(readShopSpec(P('FLANGES-NONIBR', 'F', '', 'Nos')).spare.ibr, 'Non-IBR');

// items: title from capacity, no price ever, series name from the data
const boiler = shopItem({ ...P('SOLID-FLAME', 'BOILER-SF-200', 'Supply of 2 TPH Solid Fuel ( Coal ) boiler', 'Set', 'SBH-SF-200 (2)'), price: 2075000, cost_price: 1 });
assert.equal(boiler.title, '2 TPH boiler'); assert.equal(boiler.model, 'SBH-SF-200'); assert.equal(boiler.series, 'Solid-Flame');
assert.ok(!('price' in boiler) && !('cost_price' in boiler));

// add-ons: same capacity only; solid-fuel add-ons not offered for gas boilers
const ff = shopItem(P('COMBI-FLAME', 'AUTO FUEL FEEDING SYSTEM-CF-200', 'Auto Fuel Feeding System for 2 TPH BOILER'));
const ff4 = shopItem(P('COMBI-FLAME', 'AUTO FUEL FEEDING SYSTEM-CF-400', 'Auto Fuel Feeding System for 4 TPH BOILER'));
const eco = shopItem(P('ECONOMIZER', 'WPH-200', 'Water Pre-Heater Suitable for 2 TPH Boiler'));
const gas = shopItem(P('GAS-FLAME', 'BOILER-DF-200', 'Supply of 2 TPH Dual Fuel LPG / HSD fired boiler'));
assert.deepEqual(addOnsFor(boiler, [ff, ff4, eco]).map(i => i.id), [ff.id, eco.id]);
assert.deepEqual(addOnsFor(gas, [ff, eco]).map(i => i.id), [eco.id]);

assert.deepEqual(groupSummary([boiler, shopItem(P('SOLID-FLAME', 'B', 'Supply of 0.6 TPH boiler'))]).range, '0.6–2 TPH');
assert.deepEqual(groupSummary([shopItem(P('LAISONING CHARGES ONLY', 'Descaling', 'Descaling of 2 TPH LPG boiler'))]), { count: 1, range: null, fuels: [] });
{ const a = { ...shopItem(P('SOLID-FLAME', 'B', 'x', 'Set', 'AB-SF-30')), id: 5 }, b = { ...a, id: 9 }, c = { ...a, id: 7, model: 'AB-SF-31' };
  assert.deepEqual(dedupeShopItems([b, c, a]).map(i => i.id), [7, 5]); }
console.log('shop-catalog selfcheck ok');
// a boiler with no unit in the Product Master is a model, not a part; a 'Nos' line in an equipment group is a part
assert.equal(shopItem(P('MULTI-FLAME', 'MF-400-12.5B', 'Supply of 4 TPH boiler', null)).isSet, true);
assert.equal(shopItem(P('BAG FILTER', '3-WAY DAMPER - 200', 'Damper', 'Nos')).isSet, false);
assert.equal(shopItem(P('GLOBE VALVE', 'GLOBE VALVE 40 NB', '', null)).isSet, false);
console.log('shop-catalog isSet ok');
assert.equal(shopGroupOf({ product_type: 'Combination Fuel', product_name: 'BOILER-CF-1000-WB' }), 'combi-fuel');
assert.equal(shopGroupOf({ product_type: 'Oil & Gas', product_name: 'BOILER-OF-1500-17B' }), 'oil-fired');
console.log('shop-catalog demo types ok');
