// lib/product-spec.mjs — reads the equipment spec out of a Sales Product's NAME, only where it is
// clearly written: BOILER-SF-350-WB = series SF, capacity 350 kg/hr, design WB; ...-17B = 17 bar.
// Option suffixes (BH, BB, E, CC, 2S, 2P, TF …) have no confirmed meaning and are ignored.
// Series is cross-checked against the product type (SOLID-FLAME must be SF …): a mismatch, an
// ambiguous name ("AF-DF-250") or a missing piece returns nothing for that value — never a guess.
// Pure, no DB import. Used by lib/order-spec.mjs.

export const BOILER_SERIES = ['CF', 'MF', 'OF', 'SF', 'GF', 'DF', 'AF', 'SIB'];
const SERIES_WORDS = { 'SOLID-FLAME': 'SF', 'COMBI-FLAME': 'CF', 'MULTI-FLAME': 'MF', 'OIL-FLAME': 'OF', 'GAS-FLAME': 'GF', 'AGRO-FLAME': 'AF' };
// what each product_type allows (GAS-FLAME covers two series in the catalog)
const TYPE_SERIES = { 'SOLID-FLAME': ['SF'], 'COMBI-FLAME': ['CF'], 'MULTI-FLAME': ['MF'], 'OIL-FLAME': ['OF'], 'GAS-FLAME': ['GF', 'DF'], 'AGRO-FLAME': ['AF'], PRS: ['PRS'] };
const typeKey = t => String(t ?? '').toUpperCase().replace(/\s+/g, '-').trim();
const EMPTY = { series: null, capacity: null, pressure: null, design: null };

export function readProductSpec({ name, type = null } = {}) {
  let s = String(name ?? '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(BOILER|SBH|SB)-(.+)$/) || (/^PRS-/.test(s) ? [s, 'PRS', s.slice(4)] : null);
  if (!m) return { ...EMPTY };
  let rest = m[2];
  if (m[1] === 'PRS') return { ...EMPTY, series: typeMatches(type, 'PRS') ? 'PRS' : null };
  // series word or two-letter series token at the start
  let series = null;
  for (const [w, code] of Object.entries(SERIES_WORDS)) if (rest.startsWith(w + '-') || rest === w) { series = code; rest = rest.slice(w.length).replace(/^-/, ''); break; }
  if (!series) {
    const t = rest.match(/^(CF|SF|MF|OF|GF|DF|AF|SIB)(?:-|$)/);
    if (!t) return { ...EMPTY };
    series = t[1]; rest = rest.slice(t[0].length);
    if (/^(CF|SF|MF|OF|GF|DF|AF)(?:-|$)/.test(rest) && series !== 'SIB') return { ...EMPTY }; // two series in one name (AF-DF-250)
  }
  if (!typeMatches(type, series)) return { ...EMPTY };
  const out = { ...EMPTY, series };
  if (series === 'SIB') return out; // its number means something else — not read
  const toks = rest.split('-').filter(Boolean);
  // capacity: the first token, a whole number of kg/hr ("400") or "N TPH" ("1 TPH" -> 1000)
  const cap = toks[0]?.match(/^(\d{2,4})$/);
  const tph = rest.match(/^(\d+(?:\.\d+)?) ?TPH\b/);
  if (cap) out.capacity = Number(cap[1]); else if (tph) out.capacity = Number(tph[1]) * 1000;
  for (const t of toks.slice(cap ? 1 : 0)) {
    const p = t.match(/^(\d+(?:\.\d+)?)B$/);
    if (p && Number(p[1]) >= 1 && Number(p[1]) <= 100 && out.pressure == null) out.pressure = Number(p[1]);
    else if (['WB', 'SWB', 'DB'].includes(t) && !out.design) out.design = t;
  }
  return out;
}
function typeMatches(type, series) {
  const k = typeKey(type);
  return !k || !TYPE_SERIES[k] || TYPE_SERIES[k].includes(series);
}
