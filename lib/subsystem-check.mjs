// lib/subsystem-check.mjs — "possibly missing": compare the lines a subsystem has on a project with a saved build and
// list the build's REQUIRED lines that have no counterpart. Pure, no DB. A list to read, never a gate.
//
// A line matches when it is the same Item Master item, or the same kind of item at a different size (same stem:
// "MS EN-8 ROD 63 MM" and "MS EN-8 ROD 100 MM" are both "ms en rod") — a different shaft diameter is not a missing shaft.
// Unlinked lines are compared by their description the same way. Each project line satisfies at most one build line.
export const lineStem = name => String(name ?? '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ')                       // "(1 MTR 61.65 KGS)"
  .replace(/\bie\d\b/g, ' ')                        // motor efficiency class
  .replace(/\d+(?:[./-]\d+)*\s*(?:"|'|mm|nb|nos?|mtrs?|kgs?|hp|kw|thk|th|od|id|lg|ht|w)?/g, ' ')
  .replace(/\b(?:mm|nb|od|id|thk|th|x|hp|kw|lg|ht|mtrs?|kgs?)\b/g, ' ')
  .replace(/[^a-z]+/g, ' ').trim();

// nodeLines / buildLines: [{item_id, label, ...}]; build lines may carry presence ('usual' | 'optional' | undefined=required).
export function matchBuild(nodeLines, buildLines) {
  const free = nodeLines.map((l, i) => ({ ...l, i, stem: lineStem(l.label), used: false }));
  const result = buildLines.map(b => ({ line: b, hit: false }));
  const take = (b, test) => { const f = free.find(x => !x.used && test(x)); if (f) { f.used = true; return true; } return false; };
  for (const r of result) if (r.line.item_id) r.hit = take(r.line, x => x.item_id && x.item_id === r.line.item_id);
  for (const r of result) if (!r.hit) { const s = lineStem(r.line.label); r.hit = !!s && take(r.line, x => x.stem === s); }
  return { matched: result.filter(r => r.hit).length, missing: result.filter(r => !r.hit && !r.line.presence).map(r => r.line) };
}

// the build with the most matches (ties: the earlier in the list, so callers pass the default build first)
export function bestBuild(nodeLines, builds) {
  let best = null;
  for (const b of builds) { const m = matchBuild(nodeLines, b.lines); if (!best || m.matched > best.matched) best = { build: b, ...m }; }
  return best;
}
