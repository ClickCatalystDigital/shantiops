// Item Master standardization pass, Phase 2 — must run after
// scripts/fix-item-master-categories.mjs --only=cat has landed (bom_category needs to already be
// correct before defaults are derived from it, or a duplicate-check can trust it).
//
// Two sub-passes, always in this fixed order:
//   1. Defaults backfill on EXISTING rows (default_category_fields_json / default_moc), via
//      lib/item-attributes.mjs's deriveCategoryFieldsFromName/deriveDefaultMoc.
//   2. New MS-only standard-size row generation for angle/round/square/flat (per confirmed scope
//      — SS/other grades and pipe are deliberately out of scope this round). Octagonal (0 real
//      rows today, no naming precedent to match) only runs with --include-octagonal.
//
// This pass NEVER deletes an items row, for any reason — matching the app-wide convention (no
// delete route exists on this table). On --apply, generation also writes a manifest
// (items-generated-<ts>.json) naming exactly which rows it created — not a delete capability, just
// the precise record a future, deliberate cleanup decision would need. See
// scripts/restore-items-backup.mjs for what "rollback" does and does not cover.
//
// Usage:
//   node --env-file=.env.local scripts/generate-item-master-sizes.mjs [--include-octagonal] [--apply]
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';
import { deriveDefaultMoc, deriveCategoryFieldsFromName, keyDim, gradeMatches } from '../lib/item-attributes.mjs';
import { normalizeWords } from '../lib/match-utils.js';
import { STANDARD_SECTIONS, GEOMETRY_SHAPES, roundKgPerM, squareKgPerM, octagonalKgPerM, DEFAULT_DENSITY } from '../lib/section-shapes.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeOctagonal = args.includes('--include-octagonal');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function auditWrite(action, detail) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', action, JSON.stringify(detail)],
  });
}

// ---------------------------------------------------------------------------------------------
// Sub-pass 1: defaults backfill on existing rows
// ---------------------------------------------------------------------------------------------
const DIMENSIONAL_FOR_DEFAULTS = ['plate', 'flat', 'round', 'square', 'octagonal', 'angle', 'beam', 'channel'];

async function backfillDefaults() {
  console.log(apply ? '=== Applying defaults backfill on existing rows ===\n' : '=== DRY RUN: defaults backfill on existing rows (nothing written) ===\n');
  const placeholders = DIMENSIONAL_FOR_DEFAULTS.map(() => '?').join(',');
  const rows = (await db.execute({
    sql: `SELECT id, item_name, bom_category, default_moc, default_category_fields_json FROM items
          WHERE bom_category IN (${placeholders}) AND (default_moc IS NULL OR default_category_fields_json IS NULL)
          ORDER BY bom_category, item_name`,
    args: DIMENSIONAL_FOR_DEFAULTS,
  })).rows;

  const statements = [];
  let mocSet = 0, fieldsSet = 0, neitherFound = 0;
  for (const r of rows) {
    const setCols = {};
    if (r.default_moc === null) {
      const moc = deriveDefaultMoc(r.item_name);
      if (moc) { setCols.default_moc = moc; mocSet++; }
    }
    if (r.default_category_fields_json === null) {
      const fields = deriveCategoryFieldsFromName(r.bom_category, r.item_name);
      if (fields) { setCols.default_category_fields_json = JSON.stringify(fields); fieldsSet++; }
    }
    const cols = Object.keys(setCols);
    if (!cols.length) { neitherFound++; continue; }
    console.log(`  ${r.id}\t[${r.bom_category}]\t${r.item_name}\t-> ${JSON.stringify(setCols)}`);
    statements.push({
      sql: `UPDATE items SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
      args: [...cols.map(c => setCols[c]), r.id],
    });
  }

  console.log(`\n${statements.length} row(s) would get a default set (${mocSet} default_moc, ${fieldsSet} default_category_fields_json — a row can get one, the other, or both). ${neitherFound} row(s) had nothing confidently derivable from their name and are left as-is.`);

  if (apply && statements.length) {
    await db.batch(statements, 'write');
    await auditWrite('item_master_backfill_defaults', { statementCount: statements.length, mocSet, fieldsSet });
    console.log(`\nApplied ${statements.length} statement(s) atomically.`);
  } else if (apply) {
    console.log('\nNothing to apply.');
  }
}

// ---------------------------------------------------------------------------------------------
// Sub-pass 2: new standard-size row generation, MS only
// ---------------------------------------------------------------------------------------------

// Naming templates matching the real conventions already found in the catalog (see the plan).
const SHAPE_SPECS = {
  angle: {
    sizes: () => STANDARD_SECTIONS.angle.map(r => {
      const [, a, b, t] = r.size.match(/^ISA (\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
      return { a, b, t, kg_per_m: r.kg_per_m };
    }),
    name: s => `MS ANGLE ${s.a} X ${s.b} X ${s.t} MM`,
    fields: s => ({ size: `ISA ${s.a}x${s.b}x${s.t}`, kg_per_m: s.kg_per_m }),
    group_name: 'MS ANGLE',
  },
  round: {
    // Reuses the composer's own convenience preset list (lib/section-shapes.js's GEOMETRY_SHAPES),
    // not a separate size table — one canonical source for both the dropdown and this generator.
    sizes: () => GEOMETRY_SHAPES.round.sizePresets.map(p => p.values.diameter).map(d => ({ d, kg_per_m: roundKgPerM(d, DEFAULT_DENSITY) })),
    name: s => `MS ROD ${s.d} MM (1 MTR ${round2(s.kg_per_m)} KGS)`,
    fields: s => ({ diameter: s.d }),
    group_name: 'MS ROD',
  },
  square: {
    sizes: () => GEOMETRY_SHAPES.square.sizePresets.map(p => p.values.side).map(side => ({ side, kg_per_m: squareKgPerM(side, DEFAULT_DENSITY) })),
    name: s => `MS SQUARE ROD ${s.side} MM (1 MTR ${round2(s.kg_per_m)} KGS)`,
    fields: s => ({ side: s.side }),
    group_name: 'MS SQUARE ROD',
  },
  octagonal: {
    sizes: () => GEOMETRY_SHAPES.octagonal.sizePresets.map(p => p.values.across_flats).map(a => ({ a, kg_per_m: octagonalKgPerM(a, DEFAULT_DENSITY) })),
    name: s => `MS OCTAGONAL ROD ${s.a} MM (1 MTR ${round2(s.kg_per_m)} KGS)`,
    fields: s => ({ across_flats: s.a }),
    group_name: 'MS OCTAGONAL ROD',
  },
  flat: {
    sizes: () => GEOMETRY_SHAPES.flat.sizePresets.map(p => ({ w: p.values.width, t: p.values.thickness })),
    name: s => `MS FLAT ${s.w} MM X ${s.t} MM`,
    fields: s => ({ width: s.w, thickness: s.t }),
    group_name: 'MS FLAT',
  },
};

const round2 = n => Math.round(n * 100) / 100;

// Which shape-defining size the candidate row would key to, for the duplicate check — reuses
// keyDim/gradeMatches directly rather than a parallel notion of "is this a duplicate."
async function findExistingMatch(category, candidateName, candidateMoc) {
  const key = keyDim(category, candidateName, 'catalog');
  if (!key) return null;
  const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE bom_category = ?', args: [category] })).rows;
  for (const r of rows) {
    if (keyDim(category, r.item_name, 'catalog') === key && gradeMatches(candidateMoc, r.item_name) !== false) {
      return r;
    }
  }
  return null;
}

// Secondary, informational-only warning — a true duplicate could in principle sit under a wrong
// legacy bom_category, which the primary (same-category, exact keyDim) check above would never
// see. Deliberately scoped to a DIFFERENT bom_category only: within the same category, two
// adjacent real sizes ("...X 10 MM" vs "...X 6 MM") share every word once short digit tokens are
// filtered by normalizeWords' length>=3 rule — a real, confirmed noise source (found live, in this
// script's own first dry run) that would otherwise fire on nearly every legitimate new size and
// bury the rare case this check actually exists for. Never gates the insert either way.
async function findNameSimilarityWarning(candidateName, candidateCategory) {
  const needle = normalizeWords(candidateName);
  if (!needle.length) return null;
  const rows = (await db.execute('SELECT id, item_name, bom_category FROM items')).rows;
  const hits = rows
    .filter(r => r.bom_category !== candidateCategory)
    .map(r => ({ ...r, shared: normalizeWords(r.item_name).filter(w => needle.includes(w)).length }))
    .filter(r => r.shared >= 2 && r.shared === needle.length) // every word in the candidate name must be present — not just a partial word-overlap
    .sort((a, b) => b.shared - a.shared);
  return hits[0] || null;
}

async function generateSizes() {
  console.log(apply ? '=== Applying new standard-size row generation (MS only) ===\n' : '=== DRY RUN: new standard-size row generation (nothing written) ===\n');
  const shapes = includeOctagonal ? Object.keys(SHAPE_SPECS) : Object.keys(SHAPE_SPECS).filter(s => s !== 'octagonal');
  if (!includeOctagonal) console.log('(octagonal excluded — pass --include-octagonal to generate it; 0 real rows exist today, no naming precedent to match against)\n');

  const created = [];
  for (const category of shapes) {
    const spec = SHAPE_SPECS[category];
    console.log(`--- ${category} ---`);
    for (const size of spec.sizes()) {
      const name = spec.name(size);
      const existing = await findExistingMatch(category, name, 'MS');
      if (existing) {
        console.log(`  SKIP "${name}" — already a real row: ${existing.id} "${existing.item_name}"`);
        continue;
      }
      const warning = await findNameSimilarityWarning(name, category);
      const warnMsg = warning ? `  [name-similarity warning: id ${warning.id} "${warning.item_name}" (${warning.bom_category}) shares every word — check before applying]` : '';
      console.log(`  CREATE "${name}"${warnMsg}`);
      created.push({ category, name, group_name: spec.group_name, fields: spec.fields(size) });
    }
  }

  console.log(`\n${created.length} new row(s) would be created across ${shapes.length} shape(s).`);

  if (apply && created.length) {
    const manifest = [];
    for (const row of created) {
      const { lastInsertRowid } = await db.execute({
        sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_category_fields_json, default_requires_manufacturing)
              VALUES (?, ?, 'RAW MATERIALS', ?, 'Kgs', 'MS', ?, 1)`,
        args: [row.name, row.group_name, row.category, JSON.stringify(row.fields)],
      });
      const id = Number(lastInsertRowid);
      const itemCode = `IM-${String(id).padStart(6, '0')}`;
      await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [itemCode, id] });
      manifest.push({ id, item_code: itemCode, item_name: row.name });
    }
    const manifestFile = `items-generated-${Date.now()}.json`;
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
    await auditWrite('item_master_generate_sizes', { created: manifest.length, includeOctagonal, manifestFile });
    console.log(`\nCreated ${manifest.length} row(s). Manifest written to ${manifestFile}.`);
  } else if (apply) {
    console.log('\nNothing to apply.');
  }
}

await backfillDefaults();
console.log();
await generateSizes();
