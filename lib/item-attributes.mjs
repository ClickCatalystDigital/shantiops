// lib/item-attributes.mjs — the identity of a piece of material as data, read out of free text: which single dimension
// picks the right Item Master row, the grade, and the "family" a catalog row belongs to. Pure module (no DB / framework
// imports), shared by the matcher, the import route and the selfchecks (node lib/item-match-selfcheck.mjs).
//
// The Item Master keeps one row per size ("BQ PLATE 12 MM SA 516 GR 70 …", "MS ANGLE 50 X 50 X 5 MM"). A BOM line names the
// same thing differently ("BQ PLATE MATERIAL" + grade in MOC + "2500 X 12000 X 12THK." in size). Length and width of a plate
// are per-cut, so the catalog row is identified only by the SHAPE-DEFINING size: thickness for a plate, A x B x T for an
// angle, A x B for a channel/beam, OD x wall for a pipe, diameter/side for a bar, W x T for a flat.
import { normalizeMaterial } from './match-utils.js';

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
