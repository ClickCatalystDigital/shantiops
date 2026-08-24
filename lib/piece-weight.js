// lib/piece-weight.js — pure weight formula, no imports, safe on client and server. Split out of
// lib/stock-pieces.js (which pulls in ./db) so client components (Production's Cut dialog, the PR/
// BOM composer, Stores' Add piece dialog) can compute a live preview without a server round trip.
export const DEFAULT_DENSITY = 7850; // kg/m^3, mild steel

// Weight from geometry, not a hand-typed number. plate: L x W x T x density, all mm -> m. linear:
// length x kg/m (a standard section's per-metre weight, since a non-rectangular profile's
// cross-section isn't L x W x T).
export function pieceWeight({ kind, length_mm, width_mm, thickness_mm, density, kg_per_m }) {
  if (kind === 'plate') {
    const L = Number(length_mm), W = Number(width_mm), T = Number(thickness_mm);
    if (!(L > 0 && W > 0 && T > 0)) return 0;
    return (L / 1000) * (W / 1000) * (T / 1000) * (Number(density) || DEFAULT_DENSITY);
  }
  const L = Number(length_mm), K = Number(kg_per_m);
  if (!(L > 0 && K > 0)) return 0;
  return (L / 1000) * K;
}
