// lib/section-shapes.js — the shape-type taxonomy behind the BOM composer's category dropdown
// (components/PrWorkspace.jsx) and Stores' matching inventory-item picker (components/
// StoresWorkspace.jsx). Single source of truth for both so a BOM line's size and a stock item's
// spec are generated the same way on both sides — lib/remnant-match.js's parseDims matches them as
// plain normalized text, so two people typing the same size two different ways is a real, silent
// cause of missed matches; picking from the same list/generator removes that.
//
// Two kinds of shape:
// 1. Pure geometry (round/square/flat/octagonal bar, hoop, plate/sheet): weight-per-metre is exact,
//    computed from a cross-section formula x density — no lookup table, no risk of a wrong
//    published number.
// 2. Real rolled sections (angle/beam/channel): cross-section includes fillets/taper, so kg/m
//    genuinely needs a reference value. STANDARD_SECTIONS below is a curated list of commonly
//    stocked sizes for quick autofill (convenience, not an exhaustive IS 808 transcription) — the
//    composer's "Other / custom size" option always falls back to typing a size and a kg/m by
//    hand, so nothing is ever blocked by a size not being on this list. `tee` gets no table at all
//    (no standardized shop catalog for it) and is always size + manual kg/m.
import { pieceWeight, DEFAULT_DENSITY } from './piece-weight.js';
import { normalizeWords } from './match-utils.js';

export { DEFAULT_DENSITY };

// MOC (material of construction) is exactly what lib/remnant-match.js's matching compares — a BOM
// line's moc against a stock item's moc, plain normalized text (lib/match-utils.js). Same reasoning
// as the size lists above: free text lets two people type the same material two different ways
// ("MS" vs "Mild Steel") and silently never match. Curated from what's actually used in this
// project's own BOM data (queried 2026-08-24: MS, SA 516 GR 70, IS 2062 E250, GI, SS 304, SS, SA
// 210 GR A1, CS) plus the other grades/finishes a boiler shop routinely deals with — not exhaustive,
// "Other / custom" always covers anything not listed.
export const STANDARD_MOC = [
  'MS', 'CS', 'IS 2062 E250', 'IS 2062 E350', 'SA 516 GR 60', 'SA 516 GR 70', 'SA 210 GR A1',
  'SA 106 GR B', 'SS 304', 'SS 304L', 'SS 316', 'SS 316L', 'GI', 'Aluminium',
];

export const CATEGORY_LABEL = {
  plate: 'Plate / Sheet', flat: 'Flat Bar / Hoop', round: 'Round Bar', square: 'Square Bar',
  octagonal: 'Octagonal Bar', angle: 'Angle', beam: 'Beam', channel: 'Channel', tee: 'Tee',
  pipe: 'Pipe / Tube', standard: 'Standard / Fitting', other: 'Other (not certified)',
};

// Each returns kg/m (or 0 if the dimension isn't a valid positive number yet) — feed straight into
// pieceWeight({ kind: 'linear', length_mm, kg_per_m }).
export function roundKgPerM(diameter_mm, density = DEFAULT_DENSITY) {
  const d = Number(diameter_mm);
  if (!(d > 0)) return 0;
  return (Math.PI / 4) * (d / 1000) ** 2 * density;
}

export function squareKgPerM(side_mm, density = DEFAULT_DENSITY) {
  const s = Number(side_mm);
  if (!(s > 0)) return 0;
  return (s / 1000) ** 2 * density;
}

// Also covers "hoop" — a hoop is a flat bar bent into a ring, identical cross-section.
export function flatKgPerM(width_mm, thickness_mm, density = DEFAULT_DENSITY) {
  const w = Number(width_mm), t = Number(thickness_mm);
  if (!(w > 0 && t > 0)) return 0;
  return (w / 1000) * (t / 1000) * density;
}

// Regular octagon, dimensioned by across-flats width (the standard way octagonal bar stock is
// specified). Area = 2(sqrt(2) - 1) * acrossFlats^2.
export function octagonalKgPerM(acrossFlats_mm, density = DEFAULT_DENSITY) {
  const a = Number(acrossFlats_mm);
  if (!(a > 0)) return 0;
  return 2 * (Math.SQRT2 - 1) * (a / 1000) ** 2 * density;
}

// Commonly stocked cross-sections, mm — a curated convenience list (same spirit as
// STANDARD_SECTIONS below), not an exhaustive catalog. Picking one just prefills the dimension
// field(s) below it; unlike ROLLED_CATEGORIES there's no "Other" gate to satisfy — the field is
// always a plain editable DimensionInput either way, weight is always computed from whatever's in
// it, so a preset can never leave a line stuck or silently wrong.
const ROUND_SIZES = [6, 8, 10, 12, 16, 20, 25, 32, 40, 50, 63, 75, 90, 100];
const SQUARE_SIZES = [6, 8, 10, 12, 16, 20, 25, 32, 40, 50];
const OCTAGONAL_SIZES = [10, 12, 16, 20, 25, 32, 40];
const FLAT_SIZES = [
  [20, 3], [20, 5], [25, 3], [25, 5], [25, 6], [32, 5], [32, 6], [40, 5], [40, 6], [40, 8],
  [50, 5], [50, 6], [50, 8], [50, 10], [65, 6], [65, 8], [65, 10], [75, 8], [75, 10], [75, 12],
  [100, 8], [100, 10], [100, 12],
];

// Categories computable from geometry alone — dimension fields (rendered as a unit-toggling
// DimensionInput) plus how to turn them into kg/m for the shared pieceWeight({kind:'linear', ...})
// call. `plate` is pieceWeight's own 'plate' kind (L x W x T directly), handled separately by
// callers — not listed here since it has no kgPerM step.
// Every geometry shape's kgPerM reads an optional `density` field the composer now exposes
// ("Density (kg/m³)", defaulted to mild steel's 7850 but editable) — the client's own plate
// formula, L x W x T x "specified weight", is exactly L(m) x W(m) x T(mm) x 7.85, i.e. this same
// density expressed per mm of thickness instead of per metre; different material (SS, aluminium,
// ...) means a different number here, not a different formula.
export const GEOMETRY_SHAPES = {
  flat: { dims: [{ key: 'width', label: 'Width' }, { key: 'thickness', label: 'Thickness' }, { key: 'length', label: 'Length' }],
    kgPerM: f => flatKgPerM(f.width, f.thickness, Number(f.density) || DEFAULT_DENSITY),
    sizePresets: FLAT_SIZES.map(([w, t]) => ({ label: `${w} x ${t} mm`, values: { width: w, thickness: t } })) },
  round: { dims: [{ key: 'diameter', label: 'Diameter' }, { key: 'length', label: 'Length' }],
    kgPerM: f => roundKgPerM(f.diameter, Number(f.density) || DEFAULT_DENSITY),
    sizePresets: ROUND_SIZES.map(d => ({ label: `⌀ ${d} mm`, values: { diameter: d } })) },
  square: { dims: [{ key: 'side', label: 'Side' }, { key: 'length', label: 'Length' }],
    kgPerM: f => squareKgPerM(f.side, Number(f.density) || DEFAULT_DENSITY),
    sizePresets: SQUARE_SIZES.map(s => ({ label: `${s} x ${s} mm`, values: { side: s } })) },
  octagonal: { dims: [{ key: 'across_flats', label: 'Across flats' }, { key: 'length', label: 'Length' }],
    kgPerM: f => octagonalKgPerM(f.across_flats, Number(f.density) || DEFAULT_DENSITY),
    sizePresets: OCTAGONAL_SIZES.map(a => ({ label: `${a} mm A/F`, values: { across_flats: a } })) },
};

// True rolled sections — no geometry formula, a picked/typed size + kg/m instead. `pipe` joins this
// group rather than GEOMETRY_SHAPES: real pipe is dimensioned by NB (nominal bore) + a schedule/
// class, and NB doesn't convert to an actual OD/wall-thickness without a published pipe-schedule
// table (IS 1239/ASME B36.10) — the same "a real formula would need a lookup table, not geometry
// alone" reasoning that already puts angle/beam/channel here instead of in GEOMETRY_SHAPES.
// Deliberately no STANDARD_SECTIONS.pipe entry yet — publishing a kg/m table without a verified
// source would be worse than the existing "Other / custom size" typed-kg/m fallback this category
// already gets for free via the same rendering path as angle/beam/channel.
export const ROLLED_CATEGORIES = ['angle', 'beam', 'channel', 'pipe'];
export const OTHER_SIZE = '__other__';

// Commonly stocked sizes only — a curated convenience list, not an exhaustive IS 808 transcription.
// Values are the standard published mass/metre for each designation; spot-check before relying on
// an unfamiliar size for costing. Anything not listed: pick "Other / custom size" in the UI.
export const STANDARD_SECTIONS = {
  angle: [
    { size: 'ISA 25x25x3', kg_per_m: 1.11 }, { size: 'ISA 25x25x5', kg_per_m: 1.68 },
    { size: 'ISA 30x30x3', kg_per_m: 1.36 }, { size: 'ISA 30x30x5', kg_per_m: 2.16 },
    { size: 'ISA 35x35x5', kg_per_m: 2.40 }, { size: 'ISA 40x40x5', kg_per_m: 2.95 },
    { size: 'ISA 40x40x6', kg_per_m: 3.45 }, { size: 'ISA 45x45x5', kg_per_m: 3.32 },
    { size: 'ISA 45x45x6', kg_per_m: 3.90 }, { size: 'ISA 50x50x5', kg_per_m: 3.77 },
    { size: 'ISA 50x50x6', kg_per_m: 4.47 }, { size: 'ISA 50x50x8', kg_per_m: 5.80 },
    { size: 'ISA 60x60x6', kg_per_m: 5.40 }, { size: 'ISA 65x65x6', kg_per_m: 5.86 },
    { size: 'ISA 65x65x8', kg_per_m: 7.70 }, { size: 'ISA 70x70x6', kg_per_m: 6.40 },
    { size: 'ISA 75x75x6', kg_per_m: 6.85 }, { size: 'ISA 75x75x8', kg_per_m: 8.95 },
    { size: 'ISA 75x75x10', kg_per_m: 11.00 }, { size: 'ISA 80x80x6', kg_per_m: 7.34 },
    { size: 'ISA 90x90x6', kg_per_m: 8.30 }, { size: 'ISA 90x90x8', kg_per_m: 10.90 },
    { size: 'ISA 100x100x8', kg_per_m: 12.20 }, { size: 'ISA 100x100x10', kg_per_m: 15.00 },
    { size: 'ISA 100x100x12', kg_per_m: 17.70 },
  ],
  beam: [
    { size: 'ISMB 100', kg_per_m: 11.5 }, { size: 'ISMB 125', kg_per_m: 13.0 },
    { size: 'ISMB 150', kg_per_m: 14.9 }, { size: 'ISMB 175', kg_per_m: 19.3 },
    { size: 'ISMB 200', kg_per_m: 25.4 }, { size: 'ISMB 225', kg_per_m: 31.2 },
    { size: 'ISMB 250', kg_per_m: 37.3 }, { size: 'ISMB 300', kg_per_m: 44.2 },
    { size: 'ISMB 350', kg_per_m: 52.4 }, { size: 'ISMB 400', kg_per_m: 61.6 },
    { size: 'ISMB 450', kg_per_m: 72.4 }, { size: 'ISMB 500', kg_per_m: 86.9 },
    { size: 'ISMB 600', kg_per_m: 122.6 },
  ],
  channel: [
    { size: 'ISMC 75', kg_per_m: 7.14 }, { size: 'ISMC 100', kg_per_m: 9.56 },
    { size: 'ISMC 125', kg_per_m: 13.1 }, { size: 'ISMC 150', kg_per_m: 16.4 },
    { size: 'ISMC 175', kg_per_m: 19.1 }, { size: 'ISMC 200', kg_per_m: 22.1 },
    { size: 'ISMC 225', kg_per_m: 25.9 }, { size: 'ISMC 250', kg_per_m: 30.6 },
    { size: 'ISMC 300', kg_per_m: 35.8 }, { size: 'ISMC 350', kg_per_m: 42.1 },
    { size: 'ISMC 400', kg_per_m: 49.4 },
  ],
};

// A generated, consistently-formatted profile string for the geometry shapes — the text
// lib/remnant-match.js's parseDims compares (via normalizeMaterial) to find matching stock. Both
// the BOM composer and Stores' inventory item form call this on the same dimensions, so the
// generated text always lines up exactly instead of relying on two people typing it the same way.
export function geometrySizeLabel(category, fields) {
  if (category === 'flat') return fields.width && fields.thickness ? `FLAT ${fields.width}x${fields.thickness}` : '';
  if (category === 'round') return fields.diameter ? `ROUND ${fields.diameter}` : '';
  if (category === 'square') return fields.side ? `SQUARE ${fields.side}` : '';
  if (category === 'octagonal') return fields.across_flats ? `OCTAGONAL ${fields.across_flats}` : '';
  return '';
}

// A human-readable summary of a category's fields, e.g. "2000 x 1000 x 10 mm" or "ISMB 150 x 2000mm
// long" — this is what the BOM/PR composer suggests into the line's own free-text "Size / spec"
// field (bom_items.size_spec), the column every downstream department (Procurement/Stores/
// Production) actually sees in the Master BOM table. category_fields_json (dims, size, kg_per_m,
// density) drives weight calc and stock matching but is never itself rendered anywhere — without
// this, filling in structured dimensions would leave the visible Size/Spec column blank unless
// someone re-typed the same thing by hand a second time.
export function categoryDisplaySpec(category, fields) {
  if (category === 'plate') {
    return (fields.length && fields.width && fields.thickness) ? `${fields.length} x ${fields.width} x ${fields.thickness} mm` : '';
  }
  if (GEOMETRY_SHAPES[category]) {
    const base = geometrySizeLabel(category, fields);
    return base && fields.length ? `${base} x ${fields.length}mm long` : base;
  }
  if (ROLLED_CATEGORIES.includes(category) || category === 'tee') {
    if (!fields.size || fields.size === OTHER_SIZE) return '';
    const base = fields.length ? `${fields.size} x ${fields.length}mm long` : fields.size;
    // Diameter rides through this one generated suggestion into bom_items.size_spec — the column
    // every downstream department actually sees — instead of needing a separate display field.
    return category === 'pipe' && fields.diameter_mm ? `${base}, ⌀${fields.diameter_mm}mm OD` : base;
  }
  return '';
}

// The *common* spec across every project on one PR line — the fixed/shape-defining fields only
// (Thickness for plate, the one shape dimension for round/square/octagonal/flat, Size + Diameter
// for tube/rolled sections) — never Length, or (for plate) Width, which are what actually differ
// per project/cut, not a property of the raw stock being bought. Distinct from categoryDisplaySpec,
// which is a specific instance's full spec including its own Length/Width. Used by Procurement's
// PR-group aggregate view to show "what material do we need" separately from "how much."
export function categoryShapeSpec(category, fields) {
  if (category === 'plate') {
    return fields.thickness ? `${fields.thickness} mm thick` : '';
  }
  if (GEOMETRY_SHAPES[category]) {
    return geometrySizeLabel(category, fields); // already length-free
  }
  if (ROLLED_CATEGORIES.includes(category) || category === 'tee') {
    if (!fields.size || fields.size === OTHER_SIZE) return '';
    return category === 'pipe' && fields.diameter_mm ? `${fields.size}, ⌀${fields.diameter_mm}mm OD` : fields.size;
  }
  return '';
}

// The live weight preview shown next to a category's fields, in kg. `plate` uses pieceWeight's own
// 'plate' kind directly; every other category (geometry or rolled/tee) resolves to a kg/m and goes
// through the same 'linear' kind — rolled/tee's kg/m comes from the field the user picked/typed.
export function categoryWeightKg(category, fields) {
  if (category === 'plate') {
    return pieceWeight({
      kind: 'plate', length_mm: fields.length, width_mm: fields.width, thickness_mm: fields.thickness,
      density: Number(fields.density) || DEFAULT_DENSITY,
    });
  }
  if (GEOMETRY_SHAPES[category]) {
    return pieceWeight({ kind: 'linear', length_mm: fields.length, kg_per_m: GEOMETRY_SHAPES[category].kgPerM(fields) });
  }
  if (ROLLED_CATEGORIES.includes(category) || category === 'tee') {
    return pieceWeight({ kind: 'linear', length_mm: fields.length, kg_per_m: fields.kg_per_m });
  }
  return 0;
}

// Best-effort category inference from a free-text description — shared by the PMB/CSV bulk
// importer (lib/pmb.mjs, a starting suggestion for Engineering's mandatory import-preview review)
// and the Item Master bom_category backfill (lib/db.js). Lives here, not in pmb.mjs, so the DB
// migration path can use it without pulling xlsx into every server boot. Moved verbatim from
// pmb.mjs (2026-09, Item Master bom_category round) — no change to the importer's own behavior,
// only where the function lives.
//
// Checks for electrical/consumable/rotating-equipment items run FIRST, before any structural-shape
// check, specifically because a naive matcher would otherwise mis-tag e.g. "PVC CHANNEL" (wiring
// duct) as the structural `channel` shape — a real false positive found auditing SB-1109-01-50's
// real BOM, and confirmed again against 3 real "CHANNEL PVC ..." Item Master rows while building
// the bom_category backfill (hence the added `\bPVC\b` check below). Returns null (leave
// uncategorized, a human picks it) rather than guess when nothing matches confidently, same
// "don't invent, only match" precedent as this file's own STANDARD_SECTIONS fallback.
//
// `ASBESTOS?` (not just `ASBESTOS`) — a real client workbook (SB-1108) consistently spells it
// "ASBESTOR" throughout, not a one-off typo. `THINNER?` (not just `THINNER`, so it also matches
// "TINNER") is narrower in justification (found once, not repeated) but kept anyway — the missing
// "H" is a single-character variant with essentially zero false-positive surface, unlike chasing an
// arbitrary typo in a longer/more generic word.
const CATEGORY_PATTERNS = [
  // Electrical/panel — checked before PIPE/CHANNEL so wiring hardware never falls through to a
  // structural-shape match below.
  ['other', /\bMCB\b|\bMCCB\b|CONTACTOR|\bRELAY\b|\bLED\b|\bLAMP\b|\bBUZZER\b|\bMETER\b|\bVOLT\b|\bCABLE\b|\bWIRE\b|\bLUG(S)?\b|TERMINAL|INSULATION TAPE|\bPANEL\b|\bPVC\b|\bFERRULE(S)?\b|PUSH\s*BUTTON|EMERGENCY\s*STOP/],
  // Refractory/insulation/paint/consumables.
  ['other', /ASBESTOS?|GLASS WOOL|CASTABLE|REFRACTORY|FIRE BRICK|INSULYTE|ACOSET|\bPAINT(S)?\b|TH?INNER|TERPENTOIL/],
  // Rotating/drive-train equipment. BEARING(S)/BELT deliberately removed (2026-09, checked against
  // real Item Master data): the catalog's own "BEARINGS"/"BALL BEARINGS"/"V BELTS" groups all say
  // 'standard', not 'other' — a real, pre-existing wrong guess here, now left for the catalog fuzzy
  // fallback (below) to answer correctly instead of hardcoding a confirmed-wrong one.
  ['other', /\bMOTOR\b|\bPULLEY\b|PLUMMER\s*BLOCK|\bBUSH(ING)?\b/],
  // Cast/fabricated furnace fittings — real, specific boiler-shop terms, low collision risk (found
  // auditing SB-1108's own real uncategorized rows: "TRIPLEX FIRE BAR", "H' BAR" — the same two
  // "fire bar" descriptions SYSTEM.md's Item Master bom_category audit already flagged as a known,
  // real, per-item gap, §5bn — their own catalog family exists but is itself uncategorized, so this
  // guess stays unconfirmed either way. "FIRE DOOR" was here too, but was removed (2026-09) once the
  // catalog's own "DOOR" group confirmed it's actually 'standard' — left for the fuzzy fallback
  // below to answer correctly instead of hardcoding a now-confirmed-wrong guess.
  ['other', /FIRE\s*BAR(S)?|\bHOOK(S)?\b/],
  // Pipe/tube — real hollow pressure-part stock, checked before ROUND (a tube is not a bar).
  ['pipe', /\bPIPE(S)?\b|\bTUBE(S)?\b|\bNECK\b|SAMPLING PORT/],
  // Bought-out finished components.
  ['standard', /\bVALVE(S)?\b|\bGAUGE(S)?\b|FUSIBLE PLUG|\bGASKET(S)?\b|\bBOLT(S)?\b|\bNUT(S)?\b|\bWASHER(S)?\b|\bFLANGE(S)?\b|\bCOUPLING\b|\bNIPPLE\b|\bSWITCH\b|CONTROLLER|\bSYPHON\b/],
  // Raw dimensional shapes — checked last. `PALTE` — a real client typo (letter transposition,
  // "PAD PALTE FOR SUPPORT" in SB-1108) — added as its own explicit alternative since a
  // transposition can't be expressed as a single optional character the way ASBESTOS?/TH?INNER can.
  ['plate', /\bPLATE(S)?\b|\bSHEET(S)?\b|\bPALTE\b/],
  ['flat', /\bFLAT\b|\bHOOP\b/],
  ['angle', /\bANGLE(S)?\b|\bISA\b/],
  ['beam', /\bBEAM(S)?\b|\bISMB\b/],
  ['channel', /\bCHANNEL(S)?\b|\bISMC\b/],
  ['octagonal', /OCTAGON/],
  ['square', /\bSQUARE\b/],
  ['round', /\bROUND\b|\bROD(S)?\b|\bSHAFT(S)?\b/],
  ['tee', /\bTEE\b/],
  // Nominal-bore pipe size ("40NB", "40 NB") — a real Indian piping-spec convention that shows up in
  // size_spec, not the description (e.g. "HEADER FOR S.V & AV" / "40NB X 250 Lg"), which is exactly
  // why this only matters once sizeSpec is also checked, below.
  ['pipe', /\d\s*NB\b/],
];
// `sizeSpec` (optional, added 2026-09) — a real, confirmed gap in SB-1108's own BOM: several items
// carry their actual shape indicator (ISMC/ISA/NB) in the size/spec column, not the description
// ("MS SADDLE" / "ISMC 100x50", "HEADER FOR S.V & AV" / "40NB X 250 Lg") — the description alone
// has nothing to match. Checked as one combined string so every existing pattern above (which only
// ever matched against description before this) keeps working unchanged on description-only input;
// which field a match came from doesn't matter, only pattern order does — same as before, the first
// pattern in CATEGORY_PATTERNS to match anywhere in the combined text wins.
export function inferCategory(description, sizeSpec = '') {
  const d = `${description || ''} ${sizeSpec || ''}`.toUpperCase().trim();
  if (!d) return null;
  for (const [category, re] of CATEGORY_PATTERNS) {
    if (re.test(d)) return category;
  }
  return null;
}

// Fuzzy category suggestion from the Item Master catalog's own `group_name` field (2026-09).
// **Must only ever be called when inferCategory() already returned null for the same text** — this
// is not a second opinion that can outrank the regex, it only fills the gap the regex leaves. Two
// real, rigorous regression passes against the whole real catalog proved why the ordering matters:
// letting this run unconditionally and override an existing regex answer produced a 5.6% wrong-
// answer rate, including reintroducing an already-fixed, documented bug (misreading "PVC CHANNEL"
// wiring duct as the structural `channel` shape — regex already special-cases PVC before this
// function would ever have a chance to). Restricted to only the cases regex has no opinion on at
// all, the same real catalog check comes back 272 agree / 2 disagree (99.3%) — genuinely safe to
// use as a fallback, not as a competing signal.
//
// `groups` is pre-filtered by the caller to internally-consistent group_name values only (every
// item in that group agrees on one bom_category) — a mixed/ambiguous ERP group (real examples
// found live: "ELECTRICAL", "MISSLANIOUS" [sic], each spanning 4-5 different categories) provides
// no reliable signal and must never be guessed from.
//
// Match rule: the ENTIRE group name's word set must appear in the description — not a raw
// word-count threshold, which would silently exclude every real single-word group ("DOOR", "PUMP")
// despite those being exactly the clean, curated, low-collision-risk labels a group_name usually
// is (confirmed: "FIRE DOOR" correctly resolves to 'standard' via the catalog's "DOOR" group, once
// inferCategory() no longer hardcodes a wrong guess for it — see CATEGORY_PATTERNS' own comment).
// normalizeWords splits on non-alphanumeric boundaries only (no substring matching — "GAS" can
// never match inside "GASKET", they're different whole tokens). On a tie between two equally-
// specific (same word count) groups that disagree on category, refuses rather than guessing — same
// "ties refused outright" precedent lib/tc-match.js already established for a similar problem.
export function suggestCategoryFromGroups(description, groups) {
  const descWords = new Set(normalizeWords(description));
  if (!descWords.size || !groups?.length) return null;
  let best = null; // { wordCount, category }
  let ambiguous = false;
  for (const g of groups) {
    const groupWords = normalizeWords(g.name);
    if (!groupWords.length) continue;
    if (!groupWords.every(w => descWords.has(w))) continue; // full containment required
    if (!best || groupWords.length > best.wordCount) {
      best = { wordCount: groupWords.length, category: g.category };
      ambiguous = false;
    } else if (groupWords.length === best.wordCount && g.category !== best.category) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : (best?.category ?? null);
}

// Plain Levenshtein edit distance (insert/delete/substitute, cost 1 each) — no dependency, small
// inputs (single words), classic DP table. Used only by suggestSpellingCorrection below.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prevDiag
        : 1 + Math.min(prevDiag, row[j - 1], row[j]);
      prevDiag = tmp;
    }
  }
  return row[n];
}

// The vocabulary a spelling-correction suggestion is allowed to match against — deliberately a
// small, curated set of the same literal keywords CATEGORY_PATTERNS already trusts (real, confirmed
// answers only; never derived from the regex source itself, which mixes in generic words like MOTOR/
// FLANGE that would produce noisy near-misses against ordinary short descriptions). Extend this list
// only with a word already backed by a real CATEGORY_PATTERNS entry above.
const CANONICAL_KEYWORDS = [
  ['PLATE', 'plate'], ['SHEET', 'plate'],
  ['FLAT', 'flat'], ['HOOP', 'flat'],
  ['ANGLE', 'angle'], ['BEAM', 'beam'], ['CHANNEL', 'channel'],
  ['OCTAGONAL', 'octagonal'], ['SQUARE', 'square'],
  ['ROUND', 'round'], ['SHAFT', 'round'],
  ['TEE', 'tee'], ['PIPE', 'pipe'], ['TUBE', 'pipe'],
  ['VALVE', 'standard'], ['GASKET', 'standard'], ['BOLT', 'standard'], ['NUT', 'standard'],
  ['WASHER', 'standard'], ['FLANGE', 'standard'], ['COUPLING', 'standard'], ['NIPPLE', 'standard'],
  ['THINNER', 'other'], ['ASBESTOS', 'other'],
];

// True only for the specific "two letters swapped places, everything else identical" shape — same
// length, exactly two differing positions, and each holds the other's letter. Deliberately narrower
// than "edit distance 2": a raw distance-2 threshold also accepts two *unrelated* substitutions
// (found live while building this — "PALTE" is 2 substitutions away from "VALVE" too, a real,
// wrong-answer false positive a plain distance cutoff would have suggested alongside the correct
// "PLATE" and made the whole match ambiguous). A transposition is a distinct, much safer typo class
// to trust on its own.
function isSingleTransposition(a, b) {
  if (a.length !== b.length) return false;
  let i = -1, j = -1;
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) continue;
    if (i === -1) i = k;
    else if (j === -1) j = k;
    else return false; // a third differing position — not a simple swap
  }
  return j !== -1 && a[i] === b[j] && a[j] === b[i];
}

// Best-effort "did you mean X?" for a word that inferCategory()/suggestCategoryFromGroups() both
// already gave up on (this must only ever run once both have already returned null for the same
// item — same strictly-additive-fallback precedent as suggestCategoryFromGroups' own header
// comment). Only two typo shapes are trusted, both narrow enough to rarely collide with an unrelated
// real word: a single insert/delete/substitute (edit distance exactly 1 — "TINNER" missing THINNER's
// H), or a two-letter transposition (isSingleTransposition above — "PALTE" swapping PLATE's A and L,
// which costs 2 in plain edit distance but is a much safer signal than "any 2 edits" once narrowed to
// an actual swap). A word under 4 characters is never checked at all — too much false-positive
// surface at that length. If a word qualifies against more than one distinct keyword, or more than
// one word in the description each independently qualifies, the whole thing is refused rather than
// guessed — same "ties refused outright" precedent lib/tc-match.js and suggestCategoryFromGroups
// above already established. Returns null (nothing confident to suggest) far more often than a hit,
// by design.
export function suggestSpellingCorrection(description) {
  const words = normalizeWords(description).filter(w => w.length >= 4);
  const candidates = [];
  for (const w of words) {
    const upper = w.toUpperCase();
    let hit = null;
    let wordAmbiguous = false;
    for (const [keyword, category] of CANONICAL_KEYWORDS) {
      if (upper === keyword) continue; // an exact hit would already have matched inferCategory()
      const qualifies = levenshtein(upper, keyword) === 1 || isSingleTransposition(upper, keyword);
      if (!qualifies) continue;
      if (hit && (hit.suggestedWord !== keyword || hit.category !== category)) { wordAmbiguous = true; break; }
      hit = { word: w, suggestedWord: keyword, category };
    }
    if (hit && !wordAmbiguous) candidates.push(hit);
  }
  return candidates.length === 1 ? candidates[0] : null;
}
