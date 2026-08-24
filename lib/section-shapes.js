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
  standard: 'Standard / Fitting',
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

// True rolled sections — no geometry formula, a picked/typed size + kg/m instead.
export const ROLLED_CATEGORIES = ['angle', 'beam', 'channel'];
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
    return fields.length ? `${fields.size} x ${fields.length}mm long` : fields.size;
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
