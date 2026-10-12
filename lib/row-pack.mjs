// Sends a big list of rows as one column list plus value arrays: a wide row's JSON is mostly its
// repeated field names (bom_items has ~70 columns), so this cuts the page 3-4x (live Procurement
// list 5.4 MB -> 1.5 MB). unpackRows rebuilds the same objects in the browser, nulls included.
export function packRows(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return { cols, rows: rows.map((r) => cols.map((k) => (k in r ? r[k] : null))) };
}

export function unpackRows(p) {
  if (!p || Array.isArray(p)) return p || [];
  return p.rows.map((v) => { const o = {}; p.cols.forEach((k, i) => { o[k] = v[i]; }); return o; });
}

