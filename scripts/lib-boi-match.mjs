// Attribute matcher for bought-out families the catalog stores one row per size/variant of (flanges, valves, gaskets,
// couplings, bends, pipes, bolts ...). Pure: catalog rows in, a decision out. Used by the residue pass; nothing here writes.
//   line: {desc, moc, size}  ->  {type, nb, ibr, table, cls, end, mat, sch}  and  match(line, catalog) -> {row?, why, ambiguous?}
const NB_INCH = { '1/2': 15, '3/4': 20, '1': 25, '1 1/4': 32, '1 1/2': 40, '2': 50, '2 1/2': 65, '3': 80, '4': 100, '5': 125, '6': 150, '8': 200, '10': 250, '12': 300, '14': 350, '16': 400 };
const NB_SET = new Set(Object.values(NB_INCH));
const OD_NB = { '21.3': 15, '26.9': 20, '33.4': 25, '42.2': 32, '48.3': 40, '60.3': 50, '73': 65, '73.0': 65, '88.9': 80, '114.3': 100, '141.3': 125, '168.3': 150, '219.1': 200, '273': 250, '323.9': 300 };
export const inchOfNb = nb => Object.entries(NB_INCH).find(([, v]) => v === nb)?.[0];

const U = s => String(s ?? '').toUpperCase().replace(/[“”″]/g, '"').replace(/’/g, "'").replace(/\s+/g, ' ');

// All NB sizes a text mentions, in order.
export function nbsOf(text) {
  const t = U(text).replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');
  const out = [];
  for (const m of t.matchAll(/(\d{2,3})\s*(?:NB|N\.B)(?![A-WYZ])/g)) out.push(Number(m[1]));
  if (!out.length) for (const m of t.matchAll(/(\d{2,3})\s*MM\b/g)) if (NB_SET.has(Number(m[1]))) out.push(Number(m[1]));
  if (!out.length) for (const m of t.matchAll(/(\d+ \d\/\d|\d\/\d|\d+) ?(?:"|''|INCH\b)/g)) { const nb = NB_INCH[m[1].trim()]; if (nb) out.push(nb); }
  if (!out.length) for (const m of t.matchAll(/[ΦØ∅]\s*(\d+(?:\.\d+)?)/g)) { const nb = OD_NB[m[1]]; if (nb) out.push(nb); }
  return out;
}

const TYPES = [ // first match wins; test on the DESCRIPTION
  ['dummy flange', /DUMM[EY]|COVER FLANGE|BLIND|BLANK/],
  ['flange', /FLANGE/],
  ['gasket-nm', /GASKET.*NON[- ]?METAL|NON[- ]?METAL.*GASKET/],
  ['gasket-m', /GASKET/],
  ['globe valve', /GLOBE/],
  ['gate valve', /GATE VALVE/],
  ['ball valve', /BALL VALVE/],
  ['nrv', /\bNRV\b|CHECK VALVE|NON RETURN|DISC CHECK|DISK CHECK/],
  ['safety valve', /SAFETY (?:VALVE|V\/E)/],
  ['strainer', /STRAINER/],
  ['hexnipple', /HEX ?NIPP?LE/],
  ['nipple', /NIPPLE/],
  ['coupling', /COUP?LING|COULING/],
  ['elbow', /ELBOW|\bBENDS?\b/],
  ['tee', /\bTEE\b|T JOINT|T-JOINT/],
  ['reducer', /REDUCER|EXPANDER/],
];
export const typeOf = desc => { const d = U(desc); return TYPES.find(([, re]) => re.test(d))?.[0] ?? null; };

export function featOf(desc, moc, size) {
  const all = U(`${desc} ${moc} ${size}`);
  const sz = U(`${size} ${desc}`);
  const nbs = [...new Set(nbsOf(size).length ? nbsOf(size) : nbsOf(desc))];
  const f = { type: typeOf(desc), nbs, nb: nbs[0] ?? null };
  f.ibr = /\bNON[- ]?IBR|\bNIBR/.test(all) ? 'non' : /\bIBR/.test(all) || /TABLE ?-? ?'?H|T[-\/]H\b/.test(all) ? 'ibr' : null;
  f.table = /TABLE ?-? ?'?H\b|\bT[-\/]H\b|BS ?-? ?10.{0,8}H/.test(all) ? 'H' : /\bT[-\/]E\b|TABLE ?-? ?'?E\b/.test(all) ? 'E' : null;
  f.cls = /#\s*150|CLASS[- ]?150|150 ?#|CL ?150|ANSI.{0,10}150/.test(all) ? 150 : /#\s*300|CLASS[- ]?300|300 ?#|CL ?300/.test(all) ? 300 : /#\s*3000|3000 ?(?:LBS|#)|CLASS ?#?3000/.test(all) ? 3000 : /#\s*800|800 ?#/.test(all) ? 800 : /#\s*600|600 ?#/.test(all) ? 600 : null;
  f.end = /\bF\/E\b|FLANGED/.test(all) ? 'F' : /\bS\/E\b|SCREWED|THREAD|BSPT|BSP\b/.test(all) ? 'S' : null;
  f.mat = /BRONZE|GUN ?METAL/.test(all) ? 'bronze' : /FORGED|SA ?105/.test(all) ? 'forged' : /\bC\.?I\b|SGI|\bCI\//.test(all) ? 'ci' : /\bC\.?S\b|CAST STEEL|\bCS\b|SA ?516|SA ?106|A ?234/.test(all) ? 'cs' : /\bSS\b|STAINLESS/.test(all) ? 'ss' : /\bMS\b/.test(all) ? 'ms' : null;
  f.sch = /SCH[- ]?80|SC\/80|SC-80/.test(all) ? 80 : /SCH[- ]?40|SC\/40|SC-40|SCH 40/.test(all) ? 40 : null;
  return f;
}

// Catalog rows of one type, with their own features.
export function indexCatalog(rows) {
  return rows.map(r => ({ ...r, f: featOf(r.item_name, '', '') })).filter(r => r.f.type);
}

// -> {row, why} | {ambiguous:[rows], why} | {none:true, why}
export function matchBoi(line, cat) {
  const f = featOf(line.desc, line.moc, line.size);
  if (!f.type) return { none: true, why: 'not a known bought-out family' };
  if (f.nbs.length > 1 && !['safety valve', 'reducer'].includes(f.type)) return { none: true, why: `bundled sizes ${f.nbs.join('/')}` };
  if (!f.nb) return { none: true, why: 'no NB size in the line' };
  let pool = cat.filter(r => r.f.type === f.type && r.f.nb === f.nb);
  if (!pool.length) return { none: true, why: `no catalog ${f.type} at ${f.nb} NB` };
  const score = r => {
    let s = 0, bad = 0;
    for (const k of ['ibr', 'table', 'cls', 'end', 'mat', 'sch']) {
      if (f[k] == null || r.f[k] == null) continue;
      if (f[k] === r.f[k]) s += 2; else bad++;
    }
    return { s, bad };
  };
  const scored = pool.map(r => ({ r, ...score(r) })).filter(x => x.bad === 0);
  if (!scored.length) return { none: true, why: `catalog ${f.type} ${f.nb} NB exists but attributes differ (${pool.slice(0, 3).map(r => r.item_name).join(' ; ')})` };
  const best = Math.max(...scored.map(x => x.s));
  const top = scored.filter(x => x.s === best);
  if (top.length === 1) return { row: top[0].r, why: 'attribute match', f };
  return { ambiguous: top.map(x => x.r), why: 'several catalog rows fit', f };
}
