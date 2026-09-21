// lib/item-match.mjs — match a BOM line to an Item Master row. Pure (no DB): the catalog and the remembered links are passed in,
// so the same code runs at import, in the review queue and in the selfcheck (node lib/item-match-selfcheck.mjs).
//
// Order, strongest first — the first tier that gives a single answer wins:
//   memory     a person already linked this exact line (description + MOC + size) — auto once trusted
//   family     the description is a known family (BQ PLATE MATERIAL -> the BQ PLATE rows); the line's size picks the row
//   attribute  category + shape-defining size (+ grade when the line has a specific one) leaves exactly ONE catalog row
//   suggest    several rows, or only a partial match — candidates for a person to pick, never applied silently
// 'auto' results (memory / family / attribute) are pre-filled and stay editable; 'suggest' results never are.
import { normalizeWords } from './match-utils.js';
import { keyDim, stemOf, gradeMatches, impliesSpecialGrade, memoryKeys, memoryTrusted, memoryConfidence, DIMENSIONAL } from './item-attributes.mjs';
import { splitQtyUnit, normalizeUnit } from './qty-units.mjs';

const wordsOf = s => [...new Set(normalizeWords(s))];

// rows: [{id, item_name, bom_category, uom}]
export function buildCatalogIndex(rows) {
  const byId = new Map();
  const byCatKey = new Map(); // `${category}|${key}` -> rows
  const wordMap = new Map();  // word -> Set(id)
  for (const r of rows) {
    const row = { ...r, _stem: stemOf(r.item_name), _words: wordsOf(r.item_name) };
    if (DIMENSIONAL.includes(r.bom_category)) {
      row._key = keyDim(r.bom_category, r.item_name, 'catalog');
      if (row._key) {
        const k = `${r.bom_category}|${row._key}`;
        if (!byCatKey.has(k)) byCatKey.set(k, []);
        byCatKey.get(k).push(row);
      }
    }
    byId.set(r.id, row);
    for (const w of row._words) { if (!wordMap.has(w)) wordMap.set(w, new Set()); wordMap.get(w).add(r.id); }
  }
  return { byId, byCatKey, wordMap, size: rows.length };
}

// memory: { exact: Map(exactKey -> [{item_id, approvals, rejections}]), family: Map(familyKey -> [...]) }
export const emptyMemory = () => ({ exact: new Map(), family: new Map() });
export function memoryFromRows(rows) {
  const mem = emptyMemory();
  for (const r of rows) {
    const map = r.kind === 'exact' ? mem.exact : mem.family;
    const key = r.kind === 'exact' ? `${r.alias_key}|${r.moc_key}|${r.size_key}` : `${r.alias_key}|${r.moc_key}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ item_id: r.item_id, approvals: r.approvals, rejections: r.rejections });
  }
  return mem;
}

const cand = (r, why) => ({ id: r.id, name: r.item_name, uom: r.uom || null, why });

// Fuzzy candidates by shared DESCRIPTION words — suggestion only. Words from the size cell (thk, sch, mm …) never count:
// they are noise ("PIPE ... SCH-40" must not suggest "SYHON PIPE-SCH-80").
function fuzzy(line, index, limit = 4) {
  const words = wordsOf(line.material_description);
  if (words.length < 2) return []; // one generic word ("PIPE", "PLATE") suggests nothing useful
  const score = new Map();
  for (const w of words) for (const id of index.wordMap.get(w) || []) score.set(id, (score.get(id) || 0) + 1);
  const out = [];
  for (const [id, shared] of score) {
    const r = index.byId.get(id);
    if (line.category && DIMENSIONAL.includes(line.category) && r.bom_category && r.bom_category !== line.category) continue;
    const ratio = shared / Math.min(words.length, r._words.length || 1);
    if (shared >= 2 && ratio >= 0.6) out.push({ r, shared, ratio });
  }
  out.sort((a, b) => b.shared - a.shared || b.ratio - a.ratio || a.r.item_name.length - b.r.item_name.length);
  return out.slice(0, limit).map(x => cand(x.r, 'similar name'));
}

// -> {level:'memory'|'family'|'attribute'|'suggest'|'none', itemId?, candidates:[{id,name,uom,why}], reason}
export function matchLine(line, index, memory = emptyMemory()) {
  const keys = memoryKeys(line);

  // 1. exact memory
  const exact = (memory.exact.get(keys.exactKey) || []).filter(m => index.byId.has(m.item_id)).sort((a, b) => memoryConfidence(b) - memoryConfidence(a));
  if (exact[0] && memoryTrusted(exact[0])) {
    const r = index.byId.get(exact[0].item_id);
    return { level: 'memory', itemId: r.id, candidates: [cand(r, 'linked before')], reason: 'You linked this exact line before' };
  }

  // 2 + 3. dimension-based
  const category = line.category;
  if (DIMENSIONAL.includes(category)) {
    const key = keyDim(category, line.size_spec, 'line') || keyDim(category, line.material_description, 'line');
    if (key) {
      const all = index.byCatKey.get(`${category}|${key}`) || [];
      const graded = all.filter(r => gradeMatches(line.moc, r.item_name) !== false); // false = the line names a grade this row contradicts
      const pool = graded.length ? graded : [];
      if (pool.length === 1 && gradeMatches(line.moc, pool[0].item_name) == null && impliesSpecialGrade(pool[0].item_name)) {
        return { level: 'suggest', candidates: [cand(pool[0], `${category} ${key}`)], reason: 'Only row of this size, but it is a specific pressure-part grade the line does not state' };
      }
      if (pool.length === 1) {
        return { level: 'attribute', itemId: pool[0].id, candidates: [cand(pool[0], `${category} ${key}`)], reason: `Only catalog row with ${category} ${key}${gradeMatches(line.moc, pool[0].item_name) ? ' and this grade' : ''}` };
      }
      if (pool.length > 1) {
        // family memory breaks the tie: the description is a known family, so pick the row of that family
        const fam = (memory.family.get(keys.familyKey) || []).filter(m => memoryTrusted(m) && index.byId.has(m.item_id));
        const stems = new Set(fam.map(m => index.byId.get(m.item_id)._stem));
        const inFamily = stems.size ? pool.filter(r => stems.has(r._stem)) : [];
        if (inFamily.length === 1) {
          return { level: 'family', itemId: inFamily[0].id, candidates: [cand(inFamily[0], 'same family as before')], reason: 'Same family you linked before, this size' };
        }
        return { level: 'suggest', candidates: pool.slice(0, 6).map(r => cand(r, `${category} ${key}`)), reason: `${pool.length} catalog rows share ${category} ${key}` };
      }
      if (all.length) {
        return { level: 'suggest', candidates: all.slice(0, 6).map(r => cand(r, 'size matches, grade differs')), reason: `Size ${key} matches but the grade does not` };
      }
    }
  }

  // 4. no size key (or no catalog row with it): similar names, suggestion only
  const similar = fuzzy(line, index);
  return similar.length
    ? { level: 'suggest', candidates: similar, reason: 'Similar catalog names' }
    : { level: 'none', candidates: [], reason: '' };
}

// A bare number takes its unit from the catalog row it was linked to. Never for plates (the catalog lists BQ plates by the
// metre but they are counted), never over a unit the sheet already gave.
export function fillUnitFromCatalog(qtyText, catalogUom, category) {
  if (category === 'plate') return qtyText;
  const q = splitQtyUnit(qtyText);
  const unit = normalizeUnit(catalogUom);
  return q && !q.unit && unit ? `${q.num} ${unit}` : qtyText;
}
