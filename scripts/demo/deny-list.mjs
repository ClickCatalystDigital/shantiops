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

// Misspellings in the copied product list (demo only; the client's own data is left as is).
// Whole words, case kept: ROTORY -> ROTARY, Rotory -> Rotary.
const SPELLING = {
  rotory: 'rotary', exclussions: 'exclusions', exclussion: 'exclusion', exlcussions: 'exclusions', exlcussion: 'exclusion',
  exclusssions: 'exclusions', exlclussions: 'exclusions', equalent: 'equivalent', metalic: 'metallic',
  laisoning: 'liaisoning', liasoning: 'liaisoning', lasioning: 'liaisoning', installtion: 'installation',
  installaion: 'installation', instalation: 'installation', isntallation: 'installation', battry: 'battery',
  bttery: 'battery', bettery: 'battery', certfied: 'certified', certifide: 'certified', broze: 'bronze', bronge: 'bronze',
  solonoid: 'solenoid', transparant: 'transparent', carban: 'carbon', condensat: 'condensate', dearator: 'deaerator',
  furance: 'furnace', commercail: 'commercial', suppply: 'supply', ferruls: 'ferrules', miunted: 'mounted',
  limts: 'limits', limtis: 'limits', guidence: 'guidance', ntoe: 'note', tehnical: 'technical', tehcnical: 'technical',
  specifictions: 'specifications', specifiations: 'specifications', speicifcations: 'specifications',
  expanssion: 'expansion', calries: 'calories', chrgeable: 'chargeable', accomodation: 'accommodation', pully: 'pulley',
  provison: 'provision', guidlines: 'guidelines', controler: 'controller', chiminey: 'chimney', chquered: 'chequered',
  ducitng: 'ducting', fiiling: 'filling', maintainence: 'maintenance', insualtion: 'insulation', excludded: 'excluded',
  draiwng: 'drawing', pedestial: 'pedestal', commisisoning: 'commissioning', sequencial: 'sequential', timmer: 'timer',
  mannual: 'manual', europian: 'European', colelctor: 'collector', miscelanious: 'miscellaneous', fliter: 'filter',
  buner: 'burner', combuster: 'combustor', siimplex: 'simplex', thermiic: 'thermic', briquetes: 'briquettes',
  brickettes: 'briquettes', grundfoss: 'Grundfos', danfos: 'Danfoss', tappered: 'tapered', hooper: 'hopper',
};
const spellRe = new RegExp(`\\b(${Object.keys(SPELLING).join('|')})\\b`, 'gi');
export function fixSpelling(s) {
  if (s == null) return s;
  return String(s).replace(spellRe, w => {
    const to = SPELLING[w.toLowerCase()];
    if (w === w.toUpperCase()) return to.toUpperCase();
    if (w[0] === w[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
    return to;
  });
}

export function clean(s) {
  if (s == null) return s;
  let t = String(s);
  for (const [re, to] of REPL) t = t.replace(re, to);
  return fixSpelling(t);
}
