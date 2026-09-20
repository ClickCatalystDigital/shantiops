// lib/bom-config.mjs — "Configuration" for a BOM node (System/Subsystem/...): the datasheet fields of a
// subsystem (F.D. FAN: TYPE / FLOW cfm / STATIC HEAD / SPEED RPM / MOTOR RATING ...) that a PMB sheet lists
// as rows but that are SPECIFICATION, not things to buy. Stored as a JSON array [{label, value}] on
// bom_assemblies.config_json. Pure module (no DB/framework imports) — safe for the parser, API routes and
// client components, and runnable under plain `node` (see bom-config-selfcheck.mjs).
//
// Detection is deliberately conservative: recall is sacrificed for precision, because a false positive
// would move real purchasing data out of the BOM. A row is configuration only when ALL of these hold:
//   1. its label matches the known datasheet vocabulary as a WHOLE cell (so "FLOW METER" stays an item),
//   2. no quantity and no material (MOC),
//   3. no procurement data (PR/PO/GRN qty/pending/BQ-TC/issued/received) — a real purchase is never config,
//   4. at most ONE value cell filled (size_spec / make / remarks). Two or more = ambiguous = stays an item
//      (e.g. a "MOTOR RATING 5HP" row that also names a make and a PO is the motor purchase itself).
// A label with every value cell blank is still configuration (an empty field waiting to be filled in).

export const CONFIG_LIMITS = { rows: 100, label: 120, value: 500 };

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// Whole-cell patterns, matched against the lower-cased, whitespace-collapsed label. Units are an explicit
// whitelist, not a wildcard, so real item names that merely start with the same word never match.
const LABEL_PATTERNS = [
  /^type$/,
  /^type of mounting$/,
  /^flow(?: ?rate)?(?: (?:cfm|cmh|cmph|cmm|m3\/h(?:r)?|m³\/h(?:r)?|nm3\/h(?:r)?|lpm|lph|kg\/h(?:r)?|tph|gpm|cfs|l\/s))?$/,
  /^static ?head(?: (?:inch ?wc|inchwc|in\.? ?wc|mm ?wc|mmwc|mwc|wc|kpa|pa|mbar|mm))?$/,
  /^speed(?: rpm)?$/,
  /^rpm$/,
  /^medium$/,
  /^operating ?temp(?:erature)? ?(?:\( ?°? ?c ?\)|°? ?c)?$/,
  /^motor ?rating(?: ?\(? ?(?:kw|hp|kw\/hp|hp\/kw) ?\)?)?$/,
  /^set ?pressure(?: ?[-–]? ?(?:[ivx]+(?: [ivx]+)*|\d))?(?: ?\(? ?(?:kg\/cm2|kg\/cm²|bar|psi)(?: ?\(g\))? ?\)?)?$/,
];

export function isConfigLabel(description) {
  const n = norm(description).toLowerCase().replace(/[º˚]/g, '°');
  return n.length > 0 && n.length <= 60 && LABEL_PATTERNS.some(re => re.test(n));
}

const PROCUREMENT_FIELDS = ['pr_ref', 'po_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref'];

// rec uses the same field names as the parser's row record and as a bom_items row, so the import parser and
// the in-app "convert existing items" action share one rule. Returns {label, value} or null.
// `anyLabel` skips the vocabulary check (rules 2-4 still apply): used only when a person explicitly picks an
// existing item to convert, so a label outside the fixed list (PHASE, VOLTAGE…) is still convertible while a
// row that carries real quantity/material/procurement data can never be converted by accident.
export function classifyConfigRow(rec, { anyLabel = false } = {}) {
  if (!rec || !norm(rec.material_description)) return null;
  if (!anyLabel && !isConfigLabel(rec.material_description)) return null;
  if (norm(rec.qty_text) || norm(rec.moc)) return null;
  if (PROCUREMENT_FIELDS.some(f => norm(rec[f]))) return null;
  // grn_ref is a real procurement field too, except the "0000"/"0" placeholder some sheets pre-fill.
  const grn = norm(rec.grn_ref);
  if (grn && !/^0+$/.test(grn)) return null;
  const values = [rec.size_spec, rec.make, rec.remarks].map(norm).filter(Boolean);
  if (values.length > 1) return null;
  return { label: norm(rec.material_description), value: values[0] || '' };
}

// Tolerant read: NULL, empty or corrupt JSON -> []. Never throws.
export function parseConfig(json) {
  if (!json) return [];
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(e => e && typeof e === 'object' && norm(e.label))
      .map(e => ({ label: norm(e.label), value: norm(e.value) }));
  } catch { return []; }
}

// Strict input check for an edit coming from the UI/API. Returns an error message or null.
export function validateConfigInput(list) {
  if (!Array.isArray(list)) return 'Configuration must be a list';
  if (list.length > CONFIG_LIMITS.rows) return `At most ${CONFIG_LIMITS.rows} configuration rows per node`;
  for (const e of list) {
    if (!e || typeof e !== 'object') return 'Each configuration row needs a label and a value';
    if (norm(e.label).length > CONFIG_LIMITS.label) return `A label is longer than ${CONFIG_LIMITS.label} characters`;
    if (norm(e.value).length > CONFIG_LIMITS.value) return `A value is longer than ${CONFIG_LIMITS.value} characters`;
  }
  return null;
}

// Clean list to store: trim/collapse, drop rows with an empty label, case-insensitive de-dupe keeping the
// first occurrence (labels are the row identity). Order is preserved.
export function normalizeConfig(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const label = norm(e?.label);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: norm(e?.value) });
  }
  return out;
}

// Storage form: '' / no rows -> NULL so an unconfigured node stays byte-identical to today.
export function serializeConfig(list) {
  const clean = normalizeConfig(list);
  return clean.length ? JSON.stringify(clean) : null;
}

// Merge incoming rows into an existing list (an import or a convert). Same label (case-insensitive): a
// non-empty incoming value replaces the old one, an empty incoming value never blanks an existing one;
// other rows are untouched and new labels are appended in order. Returns {list, added, updated}.
export function mergeConfig(existing, incoming) {
  const list = normalizeConfig(existing);
  const index = new Map(list.map((e, i) => [e.label.toLowerCase(), i]));
  let added = 0, updated = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const label = norm(raw?.label);
    if (!label) continue;
    const value = norm(raw?.value);
    const at = index.get(label.toLowerCase());
    if (at != null) {
      if (value && list[at].value !== value) { list[at] = { ...list[at], value }; updated++; }
    } else if (list.length < CONFIG_LIMITS.rows) {
      index.set(label.toLowerCase(), list.length);
      list.push({ label, value });
      added++;
    }
  }
  return { list, added, updated };
}
