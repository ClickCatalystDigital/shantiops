// lib/cut-validate.mjs — pure cut validation by the material's physical form; no imports, safe on
// client and server (lib/stock-pieces.js cutPiece is the source of truth, CutDialog previews it).
//   plate  : 2D. Thickness is inherited from the source; every piece (used + remnants) must fit
//            inside the source rectangle with no overlap. Checked by trying to place the pieces
//            (guillotine splits, rotation allowed), never by summing area/volume.
//   linear : 1D. Cut + remnant lengths must add up to no more than the stock length.
// Bought-out / quantity items are never piece-tracked (scalar/batch/serial stock), so they never
// reach this module.
// ponytail: guillotine layouts only — a pinwheel arrangement (rare, 5+ pieces) would read as not
// fitting. Add a free-rectangle packer if real cutting plans ever need it.

const EPS = 0.01;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = n => `${Math.round(n * 100) / 100} mm`;

// Place every piece (descending area) into the free rectangles; branches over orientation and the
// two guillotine split directions. Piece counts are tiny, so plain backtracking is fine.
function pack(free, pieces) {
  if (!pieces.length) return true;
  const [p, ...rest] = pieces;
  for (let i = 0; i < free.length; i++) {
    const f = free[i];
    for (const [w, h] of p.w === p.h ? [[p.w, p.h]] : [[p.w, p.h], [p.h, p.w]]) {
      if (w > f.w + EPS || h > f.h + EPS) continue;
      const others = free.filter((_, j) => j !== i);
      // split A: right strip full height, top strip over the piece; split B: the transpose
      const a = [{ w: f.w - w, h: f.h }, { w, h: f.h - h }];
      const b = [{ w: f.w - w, h }, { w: f.w, h: f.h - h }];
      for (const parts of [a, b]) {
        const next = [...others, ...parts.filter(r => r.w > EPS && r.h > EPS)];
        if (pack(next, rest)) return true;
      }
    }
  }
  return false;
}
const fits = (src, pieces) => pack([{ w: src.l, h: src.w }], [...pieces].sort((x, y) => y.w * y.h - x.w * x.h));

function plateErrors(source, used, remnants) {
  const errors = [];
  const src = { l: num(source.length_mm), w: num(source.width_mm) };
  const T = num(source.thickness_mm);
  const rect = (r, what, i) => {
    const l = num(r.length_mm), w = num(r.width_mm);
    const tag = (arr, label) => (arr.length > 1 ? `${label} ${i + 1}` : label);
    if (!(l > 0 && w > 0)) { errors.push(`${tag(what === 'used' ? used : remnants, what === 'used' ? 'Used piece' : 'Remnant')}: enter length and width.`); return null; }
    const t = num(r.thickness_mm);
    if (t > 0 && Math.abs(t - T) > EPS) { errors.push(`Thickness is inherited from the source plate (${fmt(T)}) and cannot be changed.`); return null; }
    const direct = l <= src.l + EPS && w <= src.w + EPS;
    const rotated = l <= src.w + EPS && w <= src.l + EPS;
    if (!direct && !rotated) {
      if (what === 'used') {
        if (l > src.l + EPS) errors.push(`Used length (${fmt(l)}) exceeds source length (${fmt(src.l)}).`);
        if (w > src.w + EPS) errors.push(`Used width (${fmt(w)}) exceeds source width (${fmt(src.w)}).`);
      } else errors.push('Remnant extends outside the source plate.');
      return null;
    }
    return { w: l, h: w };
  };
  const u = used.map((r, i) => rect(r, 'used', i));
  const m = remnants.map((r, i) => rect(r, 'remnant', i));
  if (errors.length || u.includes(null) || m.includes(null)) return errors;

  const full = u.some(p => (Math.abs(p.w - src.l) < EPS && Math.abs(p.h - src.w) < EPS) || (Math.abs(p.w - src.w) < EPS && Math.abs(p.h - src.l) < EPS));
  if (full && (u.length > 1 || m.length)) {
    errors.push(m.length && u.length === 1
      ? 'No remnant can be created because the used piece consumes the entire source plate.'
      : 'Used pieces overlap each other or do not fit within the source plate.');
    return errors;
  }
  if (u.length && !fits(src, u)) { errors.push('Used pieces overlap each other or do not fit within the source plate.'); return errors; }
  if (m.length && !fits(src, [...u, ...m])) {
    if (m.length > 1 && fits(src, [...u, m[0]]) && m.every((_, i) => fits(src, [...u, m[i]]))) errors.push('Remnants overlap each other.');
    else errors.push('Remnant does not fit within the remaining material.');
  }
  return errors;
}

function linearErrors(source, used, remnants) {
  const errors = [];
  const L = num(source.length_mm);
  let total = 0;
  used.forEach((r, i) => {
    const l = num(r.length_mm);
    if (!(l > 0)) return errors.push(`Used piece${used.length > 1 ? ` ${i + 1}` : ''}: enter a length.`);
    if (l > L + EPS) errors.push(`Used length (${fmt(l)}) exceeds source length (${fmt(L)}).`);
    total += l;
  });
  remnants.forEach((r, i) => {
    const l = num(r.length_mm);
    if (!(l > 0)) return errors.push(`Remnant${remnants.length > 1 ? ` ${i + 1}` : ''}: enter a length.`);
    if (l > L + EPS) errors.push(`Remnant length (${fmt(l)}) exceeds source length (${fmt(L)}).`);
    total += l;
  });
  if (!errors.length && total > L + EPS) errors.push(`Total cut length (${fmt(total)}) exceeds source length (${fmt(L)}).`);
  return errors;
}

// -> { errors: string[] }. `source` needs kind/length_mm(/width_mm/thickness_mm).
export function validateCut(source, used = [], remnants = []) {
  if (!used.length && !remnants.length) return { errors: ['Enter at least one used or remnant piece'] };
  return { errors: source.kind === 'plate' ? plateErrors(source, used, remnants) : linearErrors(source, used, remnants) };
}
