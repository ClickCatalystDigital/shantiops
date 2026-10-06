// scripts/match-inventory-sheet.mjs — READ-ONLY. Matches every item of the client's inventory workbook
// ("_Techno Inventory Management - 25-26 .xlsx", Inventory + Items code sheets) to an Item Master row. Writes a review CSV.
//
// The sheet names items the same way the Item Master does (one row per size, size in the name), so the tiers are:
//   name       same name, ignoring spacing/dashes/commas (keeps / . " so 1/2" never equals 12")
//   loose      same name after unit spellings (MTRS/MTR/MT, KGS/KG, NOS/NO) and "B Q" -> "BQ" are unified
//   size       same category + shape-defining size (sheet name read like a catalog name), same material
//              (MS never matches SS/CI/GI/BQ...), and exactly one row whose name contains every word of the sheet's item name
//   suggest    candidates for a person (size rows that tie, or similar names via matchLine) — never applied
//   none       nothing close
// Hand decisions from docs/inventory-sheet-decisions.json come first (status 'decided').
//
//   node --env-file=.env.local scripts/match-inventory-sheet.mjs "<path to xlsx>" [out.csv]
import { createClient } from '@libsql/client';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { inferCategory, suggestCategoryFromGroups } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { keyDim, stemOf, deriveDefaultMoc, DIMENSIONAL } from '../lib/item-attributes.mjs';
XLSX.set_fs(fs);

const [file, out = 'docs/inventory-sheet-match.csv'] = process.argv.slice(2);
if (!file) { console.error('usage: match-inventory-sheet.mjs <xlsx> [out.csv]'); process.exit(1); }

const S = v => (v == null ? '' : String(v).trim());
const fix = s => S(s).toUpperCase().replace(/\bB\s+Q\b/g, 'BQ');
const nameKey = s => fix(s).replace(/[^A-Z0-9/."]+/g, ' ').trim();
const looseKey = s => nameKey(s)
  .replace(/\b(MTRS?|MT|METERS?|METRES?)\b/g, 'MTR').replace(/\bKGS\b/g, 'KG').replace(/\bNOS\b/g, 'NO')
  .replace(/\bLTRS?|LITRES?\b/g, 'L').replace(/\s+/g, '');
const bareKey = s => looseKey(s).replace(/["']/g, '');
const MATERIALS = ['BQ', 'MS', 'SS', 'CI', 'GI', 'CS', 'GM', 'PVC', 'HDPE', 'BRASS', 'BRONZE', 'COPPER', 'ALUMINIUM', 'FORGED'];
const materialOf = s => { const w = nameKey(s).split(' '); return MATERIALS.find(m => w.includes(m)) || null; };
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))); // FLAT/FLATE
const stemWords = s => nameKey(stemOf(fix(s))).split(' ').filter(w => w.length > 1 && !/^\d/.test(w));
const overlap = (a, b) => a.filter(x => b.some(y => sameWord(x, y))).length;

// --- sheet ---
const wb = XLSX.readFile(file);
const grid = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null });
const units = new Map();
for (const r of grid('Items code').slice(2)) if (r[0] != null || r[1] != null) units.set(`${S(r[0])}|${S(r[1])}`, S(r[4]));
const rows = grid('Inventory').filter(r => (S(r[0]) || S(r[1])) && typeof r[6] === 'number'); // data rows only (skips titles and the header row)

// --- catalog ---
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const catalog = (await db.execute('SELECT id, item_code, item_name, bom_category, uom FROM items WHERE item_name IS NOT NULL ORDER BY id')).rows.map(r => ({ ...r }));
const indexBy = f => { const m = new Map(); for (const c of catalog) { const k = f(c.item_name); if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return m; };
const byName = indexBy(nameKey), byLoose = indexBy(looseKey), byBare = indexBy(bareKey);
const byId = new Map(catalog.map(c => [c.id, c]));
const groups = (await db.execute(
  `SELECT group_name, bom_category FROM items WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL
   GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`)).rows.map(g => ({ name: g.group_name, category: g.bom_category }));
const index = buildCatalogIndex(catalog);
const memory = memoryFromRows((await db.execute('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory')).rows.map(r => ({ ...r })));

// Several Item Master rows with the same name = duplicates in the Item Master; take the oldest, say so.
const take = (hits, status, why) => ({ status, item: hits[0], reason: hits.length > 1 ? `${why}; Item Master has ${hits.length} rows with this name (${hits.map(h => h.item_code).join(', ')})` : why });

// Hand decisions (scripts/create-inventory-sheet-items.mjs): "<sheet code>|<description>" -> item_code. Win over everything.
const decisions = fs.existsSync('docs/inventory-sheet-decisions.json') ? JSON.parse(fs.readFileSync('docs/inventory-sheet-decisions.json', 'utf8')) : {};
const byCode = new Map(catalog.map(c => [c.item_code, c]));

function match(desc, code) {
  const d = decisions[`${code}|${desc}`];
  if (d && byCode.get(d)) return { status: 'decided', item: byCode.get(d), reason: 'checked by hand' };
  const n = byName.get(nameKey(desc)); if (n) return take(n, 'name', 'same name');
  const l = byLoose.get(looseKey(desc)); if (l) return take(l, 'loose', 'same name (unit spelling differs)');
  const q = byBare.get(bareKey(desc)); if (q) return take(q, 'loose', 'same name (inch/foot marks differ)');

  const category = inferCategory(fix(desc), '') || suggestCategoryFromGroups(fix(desc), groups) || null;
  const mat = materialOf(desc);
  const sameMat = c => { const m = materialOf(c.item_name); return !mat || !m || m === mat; };
  if (DIMENSIONAL.includes(category)) {
    const key = keyDim(category, fix(desc), 'catalog');
    const pool = key ? (index.byCatKey.get(`${category}|${key}`) || []).map(r => byId.get(r.id)).filter(sameMat) : [];
    if (pool.length) {
      const sw = stemWords(desc);
      const scored = pool.map(c => ({ c, s: overlap(sw, stemWords(c.item_name)) })).sort((a, b) => b.s - a.s);
      const best = scored.filter(x => x.s === scored[0].s);
      // pipes/tubes: the catalog size key ignores length (6 vs 6.1 MTR), so never auto-pick; only exact/loose names link them
      if (category !== 'pipe' && scored[0].s === sw.length && sw.length && best.length === 1) return { status: 'size', item: best[0].c, reason: `${category} ${key}, same material, closest name` };
      return { status: 'suggest', cands: scored.map(x => x.c), reason: `${pool.length} Item Master rows are ${category} ${key}` };
    }
  }
  const m = matchLine({ material_description: fix(desc), moc: deriveDefaultMoc(fix(desc)) || '', size_spec: '', category }, index, memory);
  const cands = m.candidates.map(c => byId.get(c.id)).filter(c => c && sameMat(c));
  if (m.itemId && ['memory', 'family'].includes(m.level) && sameMat(byId.get(m.itemId))) return { status: 'size', item: byId.get(m.itemId), reason: m.reason };
  return cands.length ? { status: 'suggest', cands, reason: m.reason || 'similar names' } : { status: 'none', reason: '' };
}

const UNIT = { NO: 'NOS', '.NOS': 'NOS', MTRS: 'MTR', KGS: 'KG', LITRES: 'LTR', LTRS: 'LTR', L: 'LTR', PKTS: 'BOX', PAIRS: 'PAIR' };
const unitOf = u => { const k = S(u).toUpperCase(); return UNIT[k] || k; };
const seen = new Set();
const lines = [], tally = {};
for (const r of rows) {
  const desc = S(r[1]), qty = typeof r[6] === 'number' ? r[6] : null;
  const m = match(desc, S(r[0]));
  // The Inventory sheet sometimes lists the same code + description twice with the same (formula) total: count it once.
  const dupKey = `${S(r[0])}|${desc}`, dup = seen.has(dupKey); seen.add(dupKey);
  const su = units.get(dupKey) || '';
  const unitNote = dup ? 'duplicate sheet row, count once' : !su ? 'sheet has no unit' : !m.item ? '' : unitOf(su) === unitOf(m.item.uom) ? 'same' : `sheet ${su} vs Item Master ${m.item.uom}`;
  tally[m.status] = (tally[m.status] || 0) + 1;
  if (qty > 0) tally[`${m.status}, in stock`] = (tally[`${m.status}, in stock`] || 0) + 1;
  lines.push([S(r[0]), desc, qty ?? '', su, typeof r[7] === 'number' && r[7] > 0 ? r[7] : '', typeof r[11] === 'number' ? Math.round(r[11] * 100) / 100 : '',
    m.status, m.item?.item_code || '', m.item?.item_name || '', m.item?.uom || '', unitNote, m.reason,
    (m.cands || []).slice(0, 4).map(c => `${c.item_code} ${c.item_name}`).join(' | ')]);
}

const csv = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
fs.writeFileSync(out, [['sheet_code', 'description', 'qty_on_hand', 'sheet_unit', 'reorder_limit', 'avg_cost', 'status', 'item_code', 'item_name', 'item_uom', 'unit_check', 'reason', 'candidates'],
  ...lines].map(r => r.map(csv).join(',')).join('\n') + '\n');
console.log(`${rows.length} sheet rows -> ${out}`);
console.log(tally);
