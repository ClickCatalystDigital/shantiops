// lib/shop-catalog.mjs — the Shop's view of the Sales Product Master (SYSTEM.md §5fh).
// Pure, no DB import (used by the server, the pages and the selfcheck).
// - SHOP_SECTIONS / SHOP_GROUPS: how the range is shown (section -> group).
// - shopGroupOf(product): every product_type maps to exactly one group, or to HIDDEN (quote-only
//   lines). A type that matches nothing returns null — the selfcheck/dry run report it, so a new
//   type is never dropped silently.
// - readShopSpec(product): facts read from the description only where clearly written. Nothing is
//   guessed; a value that isn't written stays null.
// Prices are never part of this module's output.

export const HIDDEN = '_hidden';

export const SHOP_SECTIONS = [
  { key: 'steam', label: 'Steam Boilers', blurb: 'Packaged steam boilers for solid fuel, biomass, oil and gas, from small industrial units to 12 TPH.' },
  { key: 'thermal', label: 'Thermal Fluid & Hot Water', blurb: 'Thermic fluid heaters and hot water generators for process heat.' },
  { key: 'recovery', label: 'Heat Recovery & Steam', blurb: 'Economizers, air pre-heaters, pressure reducing stations and tanks.' },
  { key: 'emission', label: 'Emission Control & Draught', blurb: 'Cyclones, bag filters, chimneys and flue gas ducting.' },
  { key: 'fuel', label: 'Fuel Handling', blurb: 'Automatic fuel feeding and rotary air lock valves.' },
  { key: 'spares', label: 'Spares & Fittings', blurb: 'IBR and non-IBR valves, mountings, pipes, fittings and boiler spares.' },
  { key: 'services', label: 'Services', blurb: 'Site installation, IBR registration, descaling and breakdown visits.' },
];

// kind: 'equipment' (cards) | 'spares' (table) | 'services' (list). icon = lucide icon name.
export const SHOP_GROUPS = [
  { key: 'solid-fuel', section: 'steam', label: 'Solid Fuel Boilers', icon: 'Flame', kind: 'equipment', noun: 'boiler', blurb: 'Three-pass packaged boilers for coal, wood and biomass briquettes.' },
  { key: 'combi-fuel', section: 'steam', label: 'Combination Fuel Boilers', icon: 'Flame', kind: 'equipment', noun: 'boiler', blurb: 'Combination-fired boilers for a wide mix of solid fuels.' },
  { key: 'multi-fuel', section: 'steam', label: 'Multi Fuel Boilers', icon: 'Flame', kind: 'equipment', noun: 'boiler', blurb: 'Skid-mounted, plug and play boilers that burn several fuels.' },
  { key: 'agro-waste', section: 'steam', label: 'Agro Waste Boilers', icon: 'Wheat', kind: 'equipment', noun: 'boiler', blurb: 'Husk and agro-waste fired boilers with automatic fuel feeding.' },
  { key: 'oil-fired', section: 'steam', label: 'Oil Fired Boilers', icon: 'Droplet', kind: 'equipment', noun: 'boiler', blurb: 'Three-pass wet back boilers fired on HSD, LDO or furnace oil.' },
  { key: 'gas-fired', section: 'steam', label: 'Gas & Dual Fuel Boilers', icon: 'Wind', kind: 'equipment', noun: 'boiler', blurb: 'LPG, CNG and PNG fired boilers, single or dual fuel with oil.' },
  { key: 'coil-type', section: 'steam', label: 'Coil Type Boilers', icon: 'Waves', kind: 'equipment', noun: 'boiler', blurb: 'Compact water tube coil boilers, non-IBR, oil or gas fired.' },
  { key: 'non-ibr-gas', section: 'steam', label: 'Non-IBR Gas Boilers', icon: 'Wind', kind: 'equipment', noun: 'boiler', blurb: 'Small gas fired boilers that need no IBR registration.' },
  { key: 'sib', section: 'steam', label: 'Small Industrial Boilers', icon: 'Factory', kind: 'equipment', noun: 'boiler', blurb: 'SIB-licensed two-pass boilers up to 1 TPH, solid fuel, gas or oil.' },
  { key: 'thermic', section: 'thermal', label: 'Thermic Fluid Heaters', icon: 'Thermometer', kind: 'equipment', noun: 'heater', blurb: 'Solid fuel, oil and gas fired thermic fluid heaters.' },
  { key: 'hot-water', section: 'thermal', label: 'Hot Water Generators', icon: 'ShowerHead', kind: 'equipment', noun: 'generator', blurb: 'Hot water generators, including can-cleaning units.' },
  { key: 'economizer', section: 'recovery', label: 'Economizers & Water Pre-heaters', icon: 'Recycle', kind: 'equipment', noun: 'unit', blurb: 'Recover flue gas heat to pre-heat boiler feed water.' },
  { key: 'air-preheater', section: 'recovery', label: 'Air Pre-heaters', icon: 'Fan', kind: 'equipment', noun: 'unit', blurb: 'Pre-heat combustion air with flue gas heat.' },
  { key: 'prs', section: 'recovery', label: 'Pressure Reducing Stations', icon: 'Gauge', kind: 'equipment', noun: 'station', blurb: 'IBR approved, flanged pressure reducing stations.' },
  { key: 'fo-heating', section: 'recovery', label: 'FO Heating Units', icon: 'Heater', kind: 'equipment', noun: 'unit', blurb: 'Furnace oil heating and pumping units.' },
  { key: 'tanks', section: 'recovery', label: 'Tanks', icon: 'Cylinder', kind: 'equipment', noun: 'tank', blurb: 'MS overhead water and oil tanks with structure.' },
  { key: 'cyclones', section: 'emission', label: 'Cyclone Dust Collectors', icon: 'Tornado', kind: 'equipment', noun: 'cyclone', blurb: 'Single, twin and multi-cyclone dust collectors.' },
  { key: 'bag-filters', section: 'emission', label: 'Bag Filters', icon: 'Filter', kind: 'equipment', noun: 'filter', blurb: 'Bag house filters, dampers and filter bags.' },
  { key: 'chimneys', section: 'emission', label: 'Chimneys', icon: 'Factory', kind: 'equipment', noun: 'chimney', blurb: 'Straight and self-supported tapered MS chimneys.' },
  { key: 'ducting', section: 'emission', label: 'Flue Gas Ducting', icon: 'Route', kind: 'equipment', noun: 'ducting', blurb: 'Flue gas ducting and fittings to suit your layout.' },
  { key: 'fuel-feeding', section: 'fuel', label: 'Auto Fuel Feeding', icon: 'Cog', kind: 'equipment', noun: 'system', blurb: 'Screw or drum feeders with spreader burner and VFD control.' },
  { key: 'air-lock', section: 'fuel', label: 'Rotary Air Lock Valves', icon: 'RotateCw', kind: 'equipment', noun: 'valve', blurb: 'Rotary air lock valves for fuel and ash handling.' },
  { key: 'valves', section: 'spares', label: 'Valves & Strainers', icon: 'CircleDot', kind: 'spares', blurb: 'Safety, globe, NRV, gate, ball, PRV and blow-down valves; Y strainers.' },
  { key: 'mountings', section: 'spares', label: 'Mountings & Instruments', icon: 'Gauge', kind: 'spares', blurb: 'Water level gauges, Mobray controls, fusible plugs, switches and steam traps.' },
  { key: 'pipes', section: 'spares', label: 'Pipes, Tubes & Fittings', icon: 'Spline', kind: 'spares', blurb: 'Flanges, bends, couplings, nipples, reducers, ERW tubes and pipes.' },
  { key: 'rotating', section: 'spares', label: 'Blowers, Pumps & Motors', icon: 'Fan', kind: 'spares', blurb: 'Blowers, feed pumps, motors and bearings.' },
  { key: 'castings', section: 'spares', label: 'Castings & Boiler Internals', icon: 'Grid3x3', kind: 'spares', blurb: 'Fire bars, nozzles, castings and turbulators.' },
  { key: 'refractory', section: 'spares', label: 'Refractory & Insulation', icon: 'BrickWall', kind: 'spares', blurb: 'Refractory and insulation materials.' },
  { key: 'packings', section: 'spares', label: 'Packings & Gaskets', icon: 'Layers', kind: 'spares', blurb: 'Gland packings, ropes and gaskets.' },
  { key: 'services', section: 'services', label: 'Services', icon: 'Wrench', kind: 'services', blurb: 'Installation, IBR registration, descaling and breakdown visits.' },
];

export const GROUP_BY_KEY = new Map(SHOP_GROUPS.map(g => [g.key, g]));

const norm = s => String(s ?? '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

// Name rules first (misfiled rows), then type rules, in order. First hit wins.
const NAME_RULES = [
  [/^BEARING/, 'rotating'],
  [/AUTO FUEL FEED/, 'fuel-feeding'],
];
const TYPE_RULES = [
  [/^(OTHERS|NON STANDARD OFFERS|PACKING & FORWARDING)$/, HIDDEN],
  [/^SOLID[- ]FLAME$/, 'solid-fuel'],
  [/^COMBI[- ]FLAME$/, 'combi-fuel'],
  [/^MULTI[- ]FLAME$/, 'multi-fuel'],
  [/^AGRO[- ]FLAME$/, 'agro-waste'],
  [/^OIL[- ]FLAME$/, 'oil-fired'],
  [/^GAS[- ]FLAME$/, 'gas-fired'],
  [/^COIL TYPE BOILER$/, 'coil-type'],
  [/^XXX$/, 'non-ibr-gas'],
  [/^SIB-/, 'sib'],
  [/^THERMIC HEATER/, 'thermic'],
  [/^HOT WATER GENERATOR$/, 'hot-water'],
  [/^ECONOMIZER$/, 'economizer'],
  [/^AIR PRE HEATER$/, 'air-preheater'],
  [/^PRS$/, 'prs'],
  [/^FO HEATING UNIT$/, 'fo-heating'],
  [/^TANK/, 'tanks'],
  [/CYCLONE/, 'cyclones'],
  [/^BAG FILTER$/, 'bag-filters'],
  [/CHIMNEY/, 'chimneys'],
  [/^FLUE GAS DUCTING$/, 'ducting'],
  [/^ROTORY AIR LOCK VALVE$/, 'air-lock'],
  [/^(SAFETY VALVE|GLOBE VALVE|NON RETURN VALVE|NRV|GATE VALVE|BALL VALVES|PRV|BLOW DOWN VALVE|FEED CHECK VALVE|DISC CHECK|Y STRAINER|SOLONOID VALVES|X2$)/, 'valves'],
  [/^(WATER LEVEL GAUGE|MOBRAY|FUSIBLE PLUG|LEVEL SWITCH|PRESSURE SWITCH|STEAM TRAP|MOUNTINGS$|X1$|X3$)/, 'mountings'],
  [/^(FLANGES|DUMMY FLANGE|BENDS|COUPLING|NIPPLES|REDUCER|EXPANSION BEND|BOILER ERW TUBES|SEAMLESS PIPE|MS PIPE)/, 'pipes'],
  [/^(BLOWERS|PUMPS|MOTORS)$/, 'rotating'],
  [/^(CASTINGS|MISCELANIOUS)$/, 'castings'],
  [/^(REFRACTORY|INSULATION)$/, 'refractory'],
  [/^PACKINGS$/, 'packings'],
  [/^(SITE INSTALLTION CHARGES|LAISONING CHARGES|SERVICES)/, 'services'],
];

export function shopGroupOf(p) {
  const name = norm(p?.product_name);
  for (const [re, g] of NAME_RULES) if (re.test(name)) return g;
  const type = norm(p?.product_type);
  for (const [re, g] of TYPE_RULES) if (re.test(type)) return g;
  return null;
}

// ---------- text cleaning ----------
const TYPOS = [
  [/\bMiunted\b/gi, 'Mounted'], [/\bEXC?LU?S+IONS?\b/gi, 'Exclusions'], [/\bEXLCUS+IONS?\b/gi, 'Exclusions'],
  [/\bFURANCE\b/gi, 'Furnace'], [/\bBriquetes\b/gi, 'Briquettes'], [/\bBriquets\b/gi, 'Briquettes'],
  [/\bhooper\b/gi, 'hopper'], [/\bInstallaion\b/gi, 'Installation'], [/\bINSTALLTION\b/gi, 'Installation'],
  [/\bLAISONING\b/gi, 'Liaising'], [/\bLiasoning\b/gi, 'Liaising'], [/\bTAPPERED\b/gi, 'Tapered'],
  [/\bSOLONOID\b/gi, 'Solenoid'], [/\bEarthening\b/gi, 'Earthing'], [/\bGrundfoss\b/gi, 'Grundfos'],
  [/\bCOMMERCAIL\b/gi, 'Commercial'], [/\bSUPPPLY\b/gi, 'Supply'], [/\bTEHNICAL\b/gi, 'Technical'],
  [/\bROTORY\b/gi, 'Rotary'], [/\bMISCELANIOUS\b/gi, 'Miscellaneous'], [/\bEQUALENT\b/gi, 'Equivalent'],
];

export function cleanText(s) {
  let t = String(s ?? '')
    .replace(/&#61692;/g, '\n• ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/�/g, '-').replace(/[ \t]+/g, ' ').replace(/ *\n• */g, '\n• ');
  for (const [re, to] of TYPOS) t = t.replace(re, to);
  return t.trim();
}

// ALL-CAPS text -> Title Case, keeping trade abbreviations and anything with digits as written.
const KEEP = new Set('IBR NB CI CS SS TPH HSD LDO LPG CNG PNG FO MS VFD APH ID FD PRS SIB OHT KL SGI GM BR F/E ERW NRV PRV AFF RT IPS OD SA SV WB SWB DB PLC HP KW LG TH MM PTFE ASTM SMLS DIA SB SBH STF CL GF OF SF CF MF AF DF B&F MOC UTAM WJ RTD PT PID HRU OH'.split(' '));
export function smartCase(s) {
  const t = String(s ?? '').trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return t; // already mixed case
  return t.split(/(\s+|,|\/|-|\(|\))/).map(w => {
    if (!/[A-Za-z]/.test(w) || /\d/.test(w) || KEEP.has(w)) return w;
    if (w.length <= 2) return w;
    return w[0] + w.slice(1).toLowerCase();
  }).join('');
}

// ---------- spec reading ----------
const num = s => Number(String(s).replace(/,/g, ''));
const FUELS = [
  ['Coal', /\bcoal\b/i], ['Wood', /\bwood\b(?! chips)/i], ['Wood chips', /\bwood chips\b/i], ['Biomass', /\bbio ?mass\b/i],
  ['Briquettes', /\bbriquet/i], ['Husk', /\bhusk\b/i], ['Saw dust', /\bsaw ?dust\b/i], ['Pellets', /\bpellet/i],
  ['Bagasse', /\bbagasse\b/i], ['HSD', /\bHSD\b/], ['LDO', /\bLDO\b/], ['Furnace oil', /\b(furnace oil|FO)\b/],
  ['Solid fuel', /\bsolid (fuel|fired)\b/i], ['Multi fuel', /\bmulti fuel\b/i], ['LPG', /\bLPG\b/], ['CNG', /\bCNG\b/], ['PNG', /\bPNG\b/], ['Natural gas', /\bnatural gas\b/i],
];
const BUILD = [
  ['Packaged', /\bpackaged\b/i], ['Skid mounted', /\bskid mounted\b/i], ['Plug and play', /\bplug and play\b/i],
  ['Smoke tube', /\bsmoke tube\b/i], ['Water tube', /\bwater tube\b/i], ['Coil type', /\bcoil type\b/i],
  ['Concentric furnace', /\bconcentric furnace\b/i], ['Top feed', /\btop feed\b/i], ['Shell and tube', /\bshell and tube\b/i],
  ['Non-IBR', /\bnon[- ]?ibr\b/i], ['IBR approved', /\bIBR (approved|boiler)\b/i],
];
const BURNER = [
  ['Monoblock 2-stage burner', /mono ?block 2 ?stage/i], ['Dual block burner', /dual block/i],
  ['Stepless modulating burner', /stepless modulation/i], ['Pneumatic spreader', /pneumatic spreader/i],
  ['Pellet burner', /pellet fired burner/i], ['Imported burner', /imported mono ?block/i],
];

function readCapacity(t) {
  let m = t.match(/(\d+(?:\.\d+)?)\s*m ?kcal/i);
  if (m) return { value: num(m[1]), unit: 'million kcal/hr', label: `${num(m[1])} million kcal/hr`, kg: null };
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:lac|lakh)s?\s*(?:kilo ?cal|kcal)/i);
  if (m) return { value: num(m[1]), unit: 'lakh kcal/hr', label: `${num(m[1])} lakh kcal/hr`, kg: null };
  m = t.match(/flow\s*:?\s*(\d[\d,]*)\s*kgs?/i);
  if (m) return { value: num(m[1]), unit: 'kg/hr', label: `${num(m[1]).toLocaleString('en-IN')} kg/hr flow`, kg: null };
  m = t.match(/(\d+(?:\.\d+)?)\s*TPH\b/i);
  if (m) return { value: num(m[1]), unit: 'TPH', label: `${num(m[1])} TPH`, kg: Math.round(num(m[1]) * 1000) };
  m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*kgs?\s*\.?\s*\/\s*h(?:ou)?rs?\b/i);
  if (m && num(m[1]) >= 10) return { value: num(m[1]), unit: 'kg/hr', label: `${num(m[1]).toLocaleString('en-IN')} kg/hr`, kg: num(m[1]) };
  m = t.match(/(\d+(?:\.\d+)?)\s*KL\b/);
  if (m) return { value: num(m[1]), unit: 'KL', label: `${num(m[1])} KL`, kg: null };
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:liters|litres|ltrs?|L)\b/i);
  if (m && num(m[1]) >= 50) return { value: num(m[1]), unit: 'L', label: `${num(m[1])} litres`, kg: null };
  return null;
}

function readPressure(t) {
  const up = t.match(/up ?stream pressure\s*:?\s*(\d+(?:\.\d+)?)/i), down = t.match(/down ?stream(?: pressure)?\s*:?\s*(\d+(?:\.\d+)?)/i);
  if (up && down) return { value: num(up[1]), label: `${num(up[1])} → ${num(down[1])} kg/cm²` };
  const pats = [/(\d+(?:\.\d+)?)\s*(?:kgs?|kg)\.?\s*(?:\/\s*)?(?:cm|sq)/i, /(\d+(?:\.\d+)?)\s*bar\b/i, /pressure[^\d]{0,20}(\d+(?:\.\d+)?)\s*(?:kgs?|kg)\b/i];
  for (const re of pats) {
    const m = t.match(re);
    if (m && num(m[1]) >= 1 && num(m[1]) <= 100) return { value: num(m[1]), label: `${num(m[1])} kg/cm²` };
  }
  return null;
}

function readChimney(t) {
  const top = t.match(/top diameter of (\d+)\s*mm/i), h = t.match(/(\d+(?:\.\d+)?)\s*meters? height/i);
  if (!top && !h) return null;
  return [top && `${top[1]} mm top dia`, h && `${num(h[1])} m high`].filter(Boolean).join(' · ');
}

// The "mainly includes" bullets and the exclusions. Bullets are &#61692; in the source; some rows use
// " - " after "consist(s) of". Text after "REFER ..." is a pointer to the offer, not a fact.
function readLists(clean) {
  const cut = clean.split(/\bREFER\b/i)[0];
  const [body, ...ex] = cut.split(/\bExclusions?\b\s*[:\-]?/i);
  const excludes = ex.join(' ').split(/\/\/|\/|,|;|\n/).map(s => s.replace(/^[\s•.:-]+|[\s.]+$/g, '')).filter(s => s.length > 2).map(smartCase);
  let includes = body.split('\n• ').slice(1);
  if (!includes.length) {
    const m = body.match(/(?:consists? of|includes?)\s*:?\s*(-.+)$/is);
    if (m) includes = m[1].split(/\s-\s|^-\s?/).slice(1);
  }
  includes = includes.map(s => s.replace(/\s*NOTE\s*:.*$/is, '').replace(/^[\s:•-]+|[\s.]+$/g, '').trim()).filter(s => s.length > 2).map(smartCase);
  return { includes, excludes, intro: smartCase(body.split('\n• ')[0].trim()) };
}

// Spares: material / IBR / rating from the product_type name; size and make from name/description.
function readSpare(p, clean) {
  const type = norm(p.product_type), name = norm(p.product_name);
  const ibr = /NON ?IBR/.test(type) ? 'Non-IBR' : /IBR/.test(type) ? 'IBR' : null;
  const mats = [['Cast iron', /\bCI\b/], ['Carbon steel', /\bCS\b/], ['Stainless steel', /\bSS\b/], ['SG iron', /\bSGI\b/], ['Forged', /\bFORGE/], ['Gunmetal/Bronze', /\bGM|\bBR\b/], ['Brass', /\bBR\b/]];
  const material = (mats.find(([, re]) => re.test(type)) || mats.find(([, re]) => re.test(name)) || [null])[0];
  const rm = (type + ' ' + name).match(/(?:#|CLASS ?|CL ?)(150|300|600)\b/) ;
  const sch = type.match(/SC ?(40|80)\b/);
  const rating = [rm && `Class ${rm[1]}`, sch && `Sch ${sch[1]}`].filter(Boolean).join(' · ') || null;
  const sz = name.match(/(\d+(?:\.\d+)?)\s*(NB|MM)\b/) || name.match(/(\d+(?:\s?\d\/\d)?)\s*"/);
  const size = sz ? (sz[2] ? `${sz[1]} ${sz[2] === 'MM' ? 'mm' : 'NB'}` : `${sz[1]}"`) : null;
  const mk = clean.match(/\bmake\s*:?\s*([^\n]+?)\s*$/i);
  const make = mk ? mk[1].replace(/\s+/g, ' ').trim() : null;
  return { ibr, material, rating, size, make };
}

export function readShopSpec(p) {
  const clean = cleanText(p?.description);
  const text = clean.replace(/\n• /g, ' ');
  const lists = readLists(clean);
  return {
    capacity: readCapacity(text),
    pressure: readPressure(text),
    fuels: FUELS.filter(([, re]) => re.test(text)).map(([l]) => l),
    passes: (text.match(/\b(two|three|2|3)\s*pass\b/i)?.[1] || '').replace(/two/i, '2').replace(/three/i, '3') || null,
    back: /fully wet back/i.test(text) ? 'Fully wet back' : /semi wet back/i.test(text) ? 'Semi wet back' : /dry back/i.test(text) ? 'Dry back' : /\bwet back\b/i.test(text) ? 'Wet back' : null,
    build: BUILD.filter(([, re]) => re.test(text)).map(([l]) => l),
    burner: (BURNER.find(([, re]) => re.test(text)) || [null])[0],
    chimney: readChimney(text),
    ...lists,
    spare: readSpare(p || {}, clean),
  };
}

export const modelCode = p => String(p?.product_code || '').replace(/\s*\(\d+\)\s*$/, '').trim() || null;

// One shop item = what the pages and the quote basket need. No price, cost or legacy fields.
export function shopItem(p) {
  const group = shopGroupOf(p);
  if (!group || group === HIDDEN) return null;
  const g = GROUP_BY_KEY.get(group);
  const spec = readShopSpec(p);
  const name = smartCase(cleanText(p.product_name).replace(/^BOILER-/i, ''));
  const title = g.kind === 'equipment' && spec.capacity
    ? `${spec.capacity.label} ${g.noun}`
    : name;
  return {
    id: Number(p.id), group, section: g.section, kind: g.kind, title, name, model: modelCode(p),
    series: g.section === 'steam' || g.section === 'thermal' ? smartCase(cleanText(p.product_type)) : null, // from the data, not code
    unit: p.unit || null,
    // a model, not a part: unit 'Set', or an equipment line with no unit (some boilers have none in the Product Master)
    isSet: p.unit === 'Set' || (!p.unit && g.kind === 'equipment'), image_key: p.image_key || null, ...spec,
  };
}

// Same-capacity add-ons for a boiler (read from their own descriptions/names). Solid-fuel only add-ons
// (fuel feeding, cyclone, bag filter) only for boilers that burn a solid fuel.
const SOLID = new Set(['Coal', 'Wood', 'Wood chips', 'Biomass', 'Briquettes', 'Husk', 'Saw dust', 'Pellets', 'Bagasse']);
const ADDON_GROUPS = [['fuel-feeding', true], ['air-preheater', false], ['economizer', false], ['cyclones', true], ['bag-filters', true], ['chimneys', false]];
export function addOnsFor(item, items) {
  if (item.section !== 'steam' || !item.capacity?.kg) return [];
  const solid = item.fuels.some(f => SOLID.has(f)) || ['solid-fuel', 'combi-fuel', 'multi-fuel', 'agro-waste'].includes(item.group);
  const out = [];
  for (const [g, solidOnly] of ADDON_GROUPS) {
    if (solidOnly && !solid) continue;
    out.push(...items.filter(i => i.group === g && i.isSet && i.capacity?.kg === item.capacity.kg).slice(0, 2));
  }
  return out;
}

// Group card summary: model count, capacity range, fuels.
export function groupSummary(items) {
  const caps = items.filter(i => i.capacity).map(i => i.capacity);
  const unit = caps[0]?.unit;
  const same = caps.filter(c => c.unit === unit).map(c => c.value);
  const fuels = [...new Set(items.flatMap(i => i.fuels))];
  const range = same.length ? (Math.min(...same) === Math.max(...same) ? `${Math.min(...same)} ${unit}` : `${Math.min(...same)}–${Math.max(...same)} ${unit}`) : null;
  return { count: items.length, range, fuels };
}
