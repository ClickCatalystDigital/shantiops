// Builds scripts/demo/us-items.json (the US demo's item master) from the canonical US boiler catalogue:
//   node scripts/demo/us-items.mjs ~/Developer/items/ahrom_usd/us_boiler_master_catalog.json
// Cleaning: pipe ODs set to the ASME B36.10M nominal values (the catalogue rounded them from mm, e.g. 0.839 for
// 0.840, 2.374 for 2.375); synthetic "[SYNTHETIC DEMO ALIAS]" NSN aliases dropped; metric lengths in names given in
// feet and inches; no provenance, prices or anyone's own item codes carried over. Output rows feed seed-acme-us.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/demo/us-items.mjs <us_boiler_master_catalog.json>');
const { families } = JSON.parse(readFileSync(src, 'utf8'));

// ASME B36.10M outside diameters (in) by NPS.
const OD = { 0.5: 0.840, 0.75: 1.050, 1: 1.315, 1.25: 1.660, 1.5: 1.900, 2: 2.375, 2.5: 2.875, 3: 3.500, 4: 4.500, 5: 5.563,
  6: 6.625, 8: 8.625, 10: 10.750, 12: 12.750, 14: 14.000, 16: 16.000 };
const CATEGORY = { pipe_straight_seamless: 'pipe', boiler_pressure_parts: 'pipe' };
const UOM = { pipe_straight_seamless: 'FT', fastener_stud_bolt_kit: 'KIT' };
const FR = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };
const frac = n => { const w = Math.floor(n), f = FR[Math.round((n - w) * 100) / 100]; return f ? (w ? `${w}-${f}` : f) : String(w); };
const npsText = n => (n == null ? '' : `${frac(Number(n))}"`);
const mmToFtIn = mm => { const inch = mm / 25.4; const ft = Math.floor(inch / 12); const rest = Math.round(inch - ft * 12); return rest ? `${ft}' ${rest}"` : `${ft}'`; };

const out = [];
for (const [family, items] of Object.entries(families)) {
  for (const it of items) {
    // Leading NPS as US shops write it (0.5" -> 1/2", 2.0" -> 2"), metric lengths in feet and inches.
    let name = String(it.primaryNomenclature).replace(/(\d+(?:\.\d+)?)\s*mm\b/g, (_, n) => mmToFtIn(Number(n)))
      .replace(/(^|\s|x\s)(\d+\.\d+)"/g, (m, pre, n) => (FR[Number(n) % 1] !== undefined || Number(n) % 1 === 0 ? `${pre}${frac(Number(n))}"` : m));
    const dims = { ...(it.dimensions || {}) };
    if (family === 'pipe_straight_seamless' && OD[it.nps] != null) dims.od_inch = OD[it.nps];
    if (family === 'pipe_straight_seamless') {
      // "0.5\" SCH 40 (0.109\" WT) Seamless Pipe ..." -> "PIPE 1/2" SCH 40 SMLS SA-106 GR. B, 0.840 OD x 0.109 WT"
      name = `PIPE ${npsText(it.nps)} ${it.schedule} SMLS ${it.materialSpec.replace(/^ASME /, '')}, ${dims.od_inch.toFixed(3)}" OD X ${dims.wt_inch.toFixed(3)}" WT`;
    }
    const aliases = (it.erpAliases || []).filter(a => !/SYNTHETIC|^NSN-/i.test(a));
    out.push({
      code: it.canonicalItemId.replace(/^AHROM-US-/, 'US-'), name: name.toUpperCase().replace(/\s+/g, ' ').trim(), family,
      uom: UOM[family] || 'EA', bom_category: CATEGORY[family] || 'standard', spec: it.materialSpec || null, standard: it.standard || null,
      nps: it.nps ?? null, schedule: it.schedule ?? it.pressureClass ?? null, od_in: dims.od_inch ?? null, wt_in: dims.wt_inch ?? null, aliases,
    });
  }
}
const bad = out.filter(o => /SYNTHETIC|\bmm\b|price|\$/i.test(JSON.stringify(o)));
if (bad.length) throw new Error(`not clean: ${bad.map(b => b.code).join(', ')}`);
const pipeOd = out.find(o => o.code === 'US-PIP-CS-NPS2_0-SCH40');
if (pipeOd && pipeOd.od_in !== 2.375) throw new Error(`2" OD is ${pipeOd.od_in}`);
writeFileSync(new URL('./us-items.json', import.meta.url), JSON.stringify(out, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`${out.length} items -> scripts/demo/us-items.json`);
