// lib/item-attributes.mjs — the identity of a piece of material as data, read out of free text: which single dimension
// picks the right Item Master row, the grade, and the "family" a catalog row belongs to. Pure module (no DB / framework
// imports), shared by the matcher, the import route and the selfchecks (node lib/item-match-selfcheck.mjs).
//
// The Item Master keeps one row per size ("BQ PLATE 12 MM SA 516 GR 70 …", "MS ANGLE 50 X 50 X 5 MM"). A BOM line names the
// same thing differently ("BQ PLATE MATERIAL" + grade in MOC + "2500 X 12000 X 12THK." in size). Length and width of a plate
// are per-cut, so the catalog row is identified only by the SHAPE-DEFINING size: thickness for a plate, A x B x T for an
// angle, A x B for a channel/beam, OD x wall for a pipe, diameter/side for a bar, W x T for a flat.
import { normalizeMaterial } from './match-utils.js';
import { STANDARD_SECTIONS, STANDARD_MOC } from './section-shapes.js';

const NUM = '(\\d+(?:\\.\\d+)?)';
const num = s => String(parseFloat(s));
const X = '\\s*[x×]\\s*';
const flat = s => String(s ?? '').replace(/\s+/g, ' ');

// Key of the shape-defining size, e.g. plate 12 mm -> "t12", angle 50x50x5 -> "a50x50x5". `source` is 'line' (a BOM
// line's size text) or 'catalog' (an Item Master name, where a bare "12 MM" is the size). null = cannot tell.
export function keyDim(category, text, source = 'line') {
  const s = flat(text);
  let m;
  switch (category) {
    case 'plate':
      m = s.match(new RegExp(`${NUM}\\s*(?:mm\\s*)?(?:thk|thick(?:ness)?)\\b`, 'i'))
        || (source === 'catalog' ? s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i')) : null);
      return m ? `t${num(m[1])}` : null;
    case 'angle':
      if (/\b(?:ismc|ismb|islb|ismb)/i.test(s)) return null; // a line naming an angle AND a channel/beam is two parts, not one size
      m = s.match(new RegExp(`${NUM}${X}${NUM}${X}${NUM}`, 'i'));
      return m ? `a${num(m[1])}x${num(m[2])}x${num(m[3])}` : null;
    case 'channel':
    case 'beam':
      if (/\bisa\s*\d/i.test(s)) return null; // "ISMC 100x50 ISA50x50": a channel AND an angle in one cell
      m = s.match(new RegExp(`${NUM}${X}${NUM}`, 'i'));
      return m ? `c${num(m[1])}x${num(m[2])}` : null;
    case 'pipe':
      m = s.match(new RegExp(`${NUM}\\s*(?:od)?${X}${NUM}`, 'i'));
      return m ? `p${num(m[1])}x${num(m[2])}` : null;
    case 'round':
      if ((s.match(/[Φφø]|dia\b/gi) || []).length > 1) return null; // "ø100 x 115 Lg / 63dia 900 lg": more than one diameter
      m = s.match(new RegExp(`[Φφø]\\s*${NUM}`)) || s.match(new RegExp(`${NUM}\\s*mm\\s*(?:dia|round)`, 'i'))
        || (source === 'catalog' ? s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i')) : null);
      return m ? `d${num(m[1])}` : null;
    case 'square':
      m = s.match(new RegExp(`sq\\.?\\s*${NUM}`, 'i')) || (source === 'catalog' ? s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i')) : null);
      return m ? `s${num(m[1])}` : null;
    case 'flat':
      m = s.match(new RegExp(`${NUM}\\s*(?:mm)?${X}${NUM}`, 'i'));
      return m ? `f${num(m[1])}x${num(m[2])}` : null;
    default:
      return null;
  }
}

// Item Master standardization pass (2026) — deriving a catalog row's own defaults from its name,
// the inverse of what keyDim() does for matching. Longest-string-first so 'SS 304L' beats 'SS 304',
// 'SA 516 GR 70' beats a shorter fragment, etc. Word-boundary-anchored so 'MS' never matches inside
// an unrelated token.
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MOC_MATCH_ORDER = [...STANDARD_MOC].sort((a, b) => b.length - a.length);

// -> a STANDARD_MOC entry stated in the name, or null when nothing is stated. Never guesses a
// grade from context — only ever returns text the name actually contains.
export function deriveDefaultMoc(itemName) {
  const s = flat(itemName);
  for (const moc of MOC_MATCH_ORDER) {
    if (new RegExp(`\\b${escapeRegExp(moc)}\\b`, 'i').test(s)) return moc;
  }
  return null;
}

// Real published densities (kg/m³) for the STANDARD_MOC grades that clearly imply something other
// than mild steel — the pieceWeight/CategoryFieldsBlock default (~7850) is always omitted here
// rather than restated. Grades not listed (MS/CS/IS 2062 */SA */EN-8/GI/generic) stay at the
// default.
const SPECIAL_DENSITY = {
  'SS 304': 8000, 'SS 304L': 8000, 'SS 316': 8000, 'SS 316L': 8000,
  'SS 202': 7900, Aluminium: 2700, Copper: 8960,
};

function pickAngleTableSize(a, b, t) {
  // Real catalog data isn't always written "smaller side first" — check both orientations.
  return STANDARD_SECTIONS.angle.find(r => r.size === `ISA ${a}x${b}x${t}`)
    || STANDARD_SECTIONS.angle.find(r => r.size === `ISA ${b}x${a}x${t}`)
    || null;
}

// -> the exact JSON shape default_category_fields_json needs for `category` (components/
// CategoryFieldsBlock.jsx's mode='defaults'), or null when nothing confidently extracts from the
// name — the caller leaves the field unset rather than guess. Never called for 'standard'/'other'
// (CategoryFieldsBlock renders nothing for those), 'tee' (no reference table exists), or 'pipe'
// (naming-cleanup-only this round, no defaults generation yet).
export function deriveCategoryFieldsFromName(category, itemName) {
  const s = flat(itemName);
  const moc = deriveDefaultMoc(itemName);
  const density = moc && SPECIAL_DENSITY[moc] ? SPECIAL_DENSITY[moc] : null;
  let m;
  switch (category) {
    case 'plate': {
      m = s.match(new RegExp(`${NUM}\\s*(?:mm\\s*)?(?:thk|thick(?:ness)?)\\b`, 'i'))
        || s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i'));
      if (!m) return null;
      const thickness = Number(num(m[1]));
      return density ? { thickness, density } : { thickness };
    }
    case 'flat': {
      // A dual-spec cell states more than one real value for the same dimension ("25 X 4/5 MM",
      // "40 X 5 MM // 6 MM") — every genuine single-spec flat name has exactly 2 numbers (width,
      // thickness); more than that means an ambiguity a regex must never silently resolve one way.
      if ((s.match(new RegExp(NUM, 'g')) || []).length !== 2) return null;
      m = s.match(new RegExp(`${NUM}\\s*(?:mm)?${X}${NUM}`, 'i'));
      if (!m) return null;
      const width = Number(num(m[1])), thickness = Number(num(m[2]));
      return density ? { width, thickness, density } : { width, thickness };
    }
    case 'round': {
      if ((s.match(/[Φφø]|dia\b/gi) || []).length > 1) return null; // more than one diameter stated
      // Real rod names carry a trailing weight annotation with its own numbers ("(1 MTR 0.65
      // KGS)") that must never count toward this check — strip it before looking for a second
      // stated diameter ("MS ROD 28 MM / 30 MM (1 MTR 5.5 KGS)" genuinely states two, real data).
      const beforeWeight = s.replace(/\(.*$/, '');
      if ((beforeWeight.match(new RegExp(`${NUM}\\s*mm\\b`, 'gi')) || []).length > 1) return null;
      m = s.match(new RegExp(`[Φφø]\\s*${NUM}`)) || s.match(new RegExp(`${NUM}\\s*mm\\s*(?:dia|round)`, 'i'))
        || s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i'));
      if (!m) return null;
      const diameter = Number(num(m[1]));
      return density ? { diameter, density } : { diameter };
    }
    case 'square': {
      m = s.match(new RegExp(`sq\\.?\\s*${NUM}`, 'i')) || s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i'));
      if (!m) return null;
      const side = Number(num(m[1]));
      return density ? { side, density } : { side };
    }
    case 'octagonal': {
      m = s.match(new RegExp(`${NUM}\\s*mm\\b`, 'i'));
      if (!m) return null;
      const across_flats = Number(num(m[1]));
      return density ? { across_flats, density } : { across_flats };
    }
    case 'angle': {
      if (/\b(?:ismc|ismb|islb)/i.test(s)) return null;
      m = s.match(new RegExp(`${NUM}${X}${NUM}${X}${NUM}`, 'i'));
      if (!m) return null;
      const row = pickAngleTableSize(num(m[1]), num(m[2]), num(m[3]));
      if (!row) return null; // no table entry — never guessed
      const kg_per_m = density ? Math.round(row.kg_per_m * (density / 7850) * 100) / 100 : row.kg_per_m;
      return { size: row.size, kg_per_m };
    }
    case 'beam':
    case 'channel': {
      if (/\bisa\s*\d/i.test(s)) return null;
      m = s.match(new RegExp(NUM)); // first number only — real names are "MS I. BEAM 100 X 70"
      if (!m) return null;
      const prefix = category === 'beam' ? 'ISMB' : 'ISMC';
      const row = (STANDARD_SECTIONS[category] || []).find(r => r.size === `${prefix} ${num(m[1])}`);
      return row ? { size: row.size, kg_per_m: row.kg_per_m } : null;
    }
    default:
      return null; // tee / pipe / standard / other — never get a defaults object here
  }
}

export const DIMENSIONAL = ['plate', 'angle', 'channel', 'beam', 'pipe', 'round', 'square', 'flat'];

// The catalog name with its size removed — rows that differ only by size share a stem, and that shared stem is the "family"
// ("bq plate sa 516 gr 70 normalized form iv tc" for every thickness).
export function stemOf(name) {
  return String(name ?? '').toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(?:mm|x|×|thk|th|od|mtr|mtrs)\b/g, ' ')
    .replace(/\b(?:od|th|thk|x|×)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// A BOM line's grade ("SA 516 Gr.70", "EN-8") against a catalog name that carries it in the text. Only meaningful when the
// grade is specific (3+ characters once punctuation is stripped and not a generic "MS"/"CI"): those say nothing. Returns true / false / null (cannot tell).
const GENERIC_GRADES = new Set(['ms', 'cs', 'ss', 'ci', 'gi', 'sgi', 'mildsteel', 'carbonsteel']);
export function gradeMatches(moc, catalogName) {
  const g = normalizeMaterial(moc);
  if (g.length < 3 || GENERIC_GRADES.has(g)) return null;
  return normalizeMaterial(catalogName).includes(g);
}

// A catalog name that promises a specific pressure-part grade/quality. A line that states no specific grade ("MS", blank) must not
// be linked to such a row just because it is the only one of that size — it would silently upgrade the material.
export const impliesSpecialGrade = name => /\bSA[\s-]?\d{3}\b|\bBQ\b|FORM\s*IV|NORMALI[SZ]ED/i.test(String(name ?? ''));

// What memory is keyed on. alias = the description as the engineer wrote it; the size only matters for the exact tier.
export function memoryKeys(line) {
  const alias = String(line.material_description ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2).join(' ');
  const moc = normalizeMaterial(line.moc);
  const size = normalizeMaterial(line.size_spec);
  return { alias, moc, size, familyKey: `${alias}|${moc}`, exactKey: `${alias}|${moc}|${size}` };
}

// Laplace-smoothed confidence, same idea as tc_item_match_approvals: one confirmation is enough to act on, one rejection
// against it pulls it back to "suggest only".
export const memoryConfidence = m => (m.approvals + 1) / (m.approvals + m.rejections + 2);
export const memoryTrusted = m => m.approvals >= 1 && memoryConfidence(m) >= 0.6;
