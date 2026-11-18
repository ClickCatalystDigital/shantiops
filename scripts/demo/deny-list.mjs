// What must never appear in the public demo (shared by scrub-check.mjs and add-shop-demo.mjs).
export const DENY = ['shanti', 'srivaari', '36AAECS7382N1ZN', '36AAVCS1802J1Z1', 'AAECS7382N', 'AAVCS1802J', 'nacharam', 'kucharam',
  'kuncharam', 'toopran', 'asian brown', 'asian_brown', 'virchow', 'jaganmohan', 'shantiboilers', 'hkm_charitable', 'STF-IBR',
  'telangana, hyderabad', 'SOLID-FLAME', 'COMBI-FLAME', 'MULTI-FLAME', 'OIL-FLAME', 'GAS-FLAME', 'AGRO-FLAME'];
export const DENY_WORDS = ['HKM', 'SB-1'];

// Rewrites client names/places/GSTINs in copied text (used by add-shop-demo.mjs and copy-item-master.mjs).
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const denyRe = new RegExp([...DENY.map(esc), ...DENY_WORDS.map(w => `\\b${esc(w)}\\b`)].join('|'), 'i');

// Boiler families get the generic names the Shop also understands (lib/shop-catalog.mjs).
export const TYPES = { 'SOLID-FLAME': 'Solid Fuel', 'SOLID FLAME': 'Solid Fuel', 'COMBI-FLAME': 'Combination Fuel', 'COMBI FLAME': 'Combination Fuel',
  'MULTI-FLAME': 'Multi Fuel', 'MULTI FLAME': 'Multi Fuel', 'OIL-FLAME': 'Oil Fuel', 'OIL FLAME': 'Oil Fuel',
  'GAS-FLAME': 'Gas Fuel', 'GAS FLAME': 'Gas Fuel', 'AGRO-FLAME': 'Agro Fuel', 'AGRO FLAME': 'Agro Fuel' };
const FAMILY = { solid: 'Solid Fuel', combi: 'Combination Fuel', multi: 'Multi Fuel', oil: 'Oil Fuel', gas: 'Gas Fuel', agro: 'Agro Fuel' };
const REPL = [
  [/\b(solid|combi|multi|oil|gas|agro)[- ]?flame/gi, (_, f) => FAMILY[f.toLowerCase()]],
  [/shanti\s*boilers?(\s*&\s*pressure\s*vessels)?(\s*\(p\))?(\s*(pvt\.?|private))?(\s*(ltd\.?|limited))?/gi, 'Acme Boilers'],
  [/shanti\s*techno\s*fab(\s*(pvt\.?|private))?(\s*(ltd\.?|limited))?/gi, 'Acme Boilers'],
  [/shantiboilers/gi, 'acmeboilers'], [/shanti|srivaari/gi, 'Acme'],
  [/\bSTF-IBR/gi, 'AB-IBR'], [/\b(SBH|STF|SBPV)\b/g, 'AB'], [/\bSB-/g, 'AB-'], [/\bHKM\b/gi, 'customer'],
  [/36AA[A-Z0-9]{11}|AA[EV]CS\d{4}[A-Z]/g, ''],
  [/nacharam|kucharam|kuncharam|toopran/gi, 'Pune'], [/telangana/gi, 'Maharashtra'], [/hyderabad/gi, 'Pune'],
];
export function clean(s) {
  if (s == null) return s;
  let t = String(s);
  for (const [re, to] of REPL) t = t.replace(re, to);
  return t;
}
