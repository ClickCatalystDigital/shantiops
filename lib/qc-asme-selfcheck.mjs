// lib/qc-asme-selfcheck.mjs — QW-322 continuity and weld-map checks (lib/qc-asme.mjs).
import { continuityLapse, continuityRows, weldMapProblems, asmeForm, parseAsmeData } from './qc-asme.mjs';

const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} != ${b}`); };
eq(continuityLapse('2026-03-15'), '2026-09-15', 'six months');
eq(continuityLapse('2026-08-31'), '2027-02-28', 'month end clamps');
eq(continuityLapse('2027-08-31'), '2028-02-29', 'leap year');
const data = {
  wps: [{ id: 'WPS-101', process: 'SAW' }, { id: 'WPS-102', process: 'SMAW' }],
  welders: [{ stamp: 'W-07', processes: { SAW: { last_weld: '2026-09-01' }, SMAW: { last_weld: '2026-01-10' } } }],
  welds: [{ id: 'L1', wps: 'WPS-101', welders: ['W-07'] }, { id: 'C1', wps: 'WPS-102', welders: ['W-07'] }, { id: 'N1', wps: 'WPS-101', welders: ['W-09'] }],
};
const rows = continuityRows(data.welders, '2026-10-01');
eq(rows.find(r => r.process === 'SAW').status, 'Current', 'current');
eq(rows.find(r => r.process === 'SMAW').status, 'Lapsed', 'lapsed');
eq(weldMapProblems(data, '2026-10-01').length, 2, 'lapsed SMAW + unknown welder');
eq(asmeForm({ form: 'U-1A' }), 'U-1A', 'form'); eq(asmeForm({}), 'P-2', 'default form');
eq(parseAsmeData('{"form":"U-1A"}').form, 'U-1A', 'parse'); eq(Object.keys(parseAsmeData('x')).length, 0, 'bad json');
console.log('qc-asme ok');
