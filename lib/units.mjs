// lib/units.mjs — the Metric / Imperial Units setting. Stored values are always metric (what the calc
// sheet, BOM weights, cutting and QC records hold); the setting only changes what is shown and typed.
// Default by market (lib/market.js DEFAULT_UNITS); each browser can switch in Settings (cookie `units`).
// Pure: no DOM or DB.
import { DEFAULT_UNITS } from './market.js';

// metric unit -> [imperial unit, factor or converter]. Keys are matched case-insensitively after
// normalising (kg/cm² = kg/cm2 = kgf/cm2).
const TABLE = {
  mm: ['in', 1 / 25.4], m: ['ft', 3.280839895], mtr: ['ft', 3.280839895], km: ['mi', 0.621371192],
  kg: ['lb', 2.20462262], kgs: ['lb', 2.20462262], t: ['ton', 1.10231131], mt: ['ton', 1.10231131],
  'kg/cm2': ['psi', 14.2233433], bar: ['psi', 14.5037738], mpa: ['psi', 145.037738], 'n/mm2': ['psi', 145.037738],
  c: ['°F', { to: v => v * 9 / 5 + 32, from: v => (v - 32) * 5 / 9 }],
  'kg/hr': ['lb/hr', 2.20462262], tph: ['lb/hr', 2204.62262], m2: ['sq ft', 10.7639104], m3: ['cu ft', 35.3146667],
  'kg/m': ['lb/ft', 0.671968975], 'kg/m2': ['lb/sq ft', 0.204816144], 'kcal/hr': ['Btu/hr', 3.96832072], kw: ['hp', 1.34102209],
  lpm: ['gpm', 0.264172052], l: ['gal', 0.264172052],
};
const norm = u => String(u || '').trim().toLowerCase().replace(/²/g, '2').replace(/³/g, '3').replace(/^kgf\//, 'kg/').replace(/^°?c$/, 'c').replace(/\s+/g, '');

export const UNIT_SYSTEMS = ['metric', 'imperial'];
export const defaultUnits = () => DEFAULT_UNITS;
export const isImperial = units => (units || DEFAULT_UNITS) === 'imperial';

// Can this metric unit be shown in imperial?
export const convertible = u => !!TABLE[norm(u)];
// The label to show for a metric unit (imperial label, or the unit itself when it has none).
export const unitLabel = (u, units = 'imperial') => (isImperial(units) && TABLE[norm(u)]?.[0]) || u;

export function toImperial(v, u) {
  const e = TABLE[norm(u)]; const n = Number(v);
  if (!e || v === '' || v == null || !Number.isFinite(n)) return v;
  return typeof e[1] === 'number' ? n * e[1] : e[1].to(n);
}
export function fromImperial(v, u) {
  const e = TABLE[norm(u)]; const n = Number(v);
  if (!e || v === '' || v == null || !Number.isFinite(n)) return v;
  return typeof e[1] === 'number' ? n / e[1] : e[1].from(n);
}

// "10.54 kg/cm2" -> "150 psi" under imperial; metric passes through. digits: significant decimals kept.
export function showQty(v, u, units, digits = 2) {
  if (v === '' || v == null) return '';
  if (!isImperial(units) || !convertible(u)) return u ? `${v} ${u}` : String(v);
  const x = toImperial(v, u);
  return `${trim(x, digits)} ${unitLabel(u, 'imperial')}`;
}
export const trim = (x, digits = 2) => (Number.isFinite(Number(x)) ? String(Number(Number(x).toFixed(digits))) : String(x));

// Free text sizes like "2500 X 6000 X 12 THK" or "63.5 OD X 3.25 THK": every mm number shown in inches.
// Only used for display under imperial; a size that carries its own unit (NB, inch) is left alone.
export function showSizeText(text, units) {
  if (!isImperial(units) || !text || /\b(NB|IN|INCH|")\b/i.test(text)) return text;
  return String(text).replace(/(\d+(?:\.\d+)?)/g, n => trim(Number(n) / 25.4, 3) + '"');
}

// Screen text under imperial (components/UsWords.jsx): "6000×1500×10 mm" -> "236.22×59.06×0.39 in", "706.5 kg" -> "1,557.6 lb",
// "10.54 kg/cm²" -> "150 psi", "185 °C" -> "365 °F", "600 kg/hr" -> "1,323 lb/hr". Display only; typed values are untouched.
const N = '(-?\\d[\\d,]*(?:\\.\\d+)?)';
const num = s => Number(String(s).replace(/,/g, ''));
const us = (x, d) => Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d });
const RULES = [
  [new RegExp(`${N}\\s*kgf?\\/cm(?:²|2)`, 'g'), m => `${us(num(m[1]) * 14.2233433, 0)} psi`],
  [new RegExp(`${N}\\s*kg\\/hr\\b`, 'g'), m => `${us(num(m[1]) * 2.20462262, 0)} lb/hr`],
  [new RegExp(`${N}\\s*°C\\b`, 'g'), m => `${us(num(m[1]) * 9 / 5 + 32, 0)} °F`],
  [new RegExp(`${N}\\s*[×xX]\\s*${N}\\s*[×xX]\\s*${N}\\s*mm\\b`, 'g'), m => `${us(num(m[1]) / 25.4, 2)}×${us(num(m[2]) / 25.4, 2)}×${us(num(m[3]) / 25.4, 3)} in`],
  [new RegExp(`${N}\\s*[×xX]\\s*${N}\\s*mm\\b`, 'g'), m => `${us(num(m[1]) / 25.4, 2)}×${us(num(m[2]) / 25.4, 2)} in`],
  [new RegExp(`${N}\\s*mm\\b(?!\\s*(?:WC|w\\.c))`, 'g'), m => `${us(num(m[1]) / 25.4, num(m[1]) >= 254 ? 1 : 3)} in`],
  [new RegExp(`${N}\\s*kgs?\\b(?!\\/)`, 'gi'), m => `${us(num(m[1]) * 2.20462262, 1)} lb`],
  [new RegExp(`${N}\\s*m²`, 'g'), m => `${us(num(m[1]) * 10.7639104, 0)} sq ft`],
];
export function imperialText(text) {
  if (!text || typeof text !== 'string' || !/\d/.test(text)) return text;
  let t = text;
  for (const [re, fn] of RULES) t = t.replace(re, (...a) => fn(a));
  return t;
}
