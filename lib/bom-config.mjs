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

export const CONFIG_LIMITS = { rows: 100, label: 120, value: 500, unit: 30 };

// Units offered in the configuration unit box (free text is still allowed — this is only the suggestion list).
export const CONFIG_UNIT_SUGGESTIONS = ['KG/CM2(G)', 'Kg/hr', 'cfm', 'm3/hr', 'inchwc', 'mmWC', 'RPM', '°C', 'HP', 'kW', 'bar', 'psi', 'mm'];

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
  // safety-valve relieving capacity — sheets spell it "RELIEVEING"; \w* keeps the typo tolerant
  /^(?:min(?:imum)?\.? ?)?reliev\w* ?cap(?:acity)?$/,
  // the chimney's overall geometry note, not a purchasable line — see isAlwaysConfigLabel below,
  // which also needs this pattern to bypass the normal qty/MOC gate.
  /^chimney ?size:?$/,
];

export function isConfigLabel(description) {
  const n = norm(description).toLowerCase().replace(/[º˚]/g, '°');
  return n.length > 0 && n.length <= 60 && LABEL_PATTERNS.some(re => re.test(n));
}

// Labels that are configuration EVEN WHEN a real qty/MOC is attached — real PMB data, checked
// live: "CHIMNEY SIZE:" rows carry moc="MILD STEEL" and a qty ("30 Mtr"), which the normal
// qty/MOC gate below would treat as purchasing data. But the cell itself bundles the whole
// chimney's geometry as one multi-line note (top dia, bottom dia, several tapered/straight
// pieces at different thicknesses) — not one buyable line; the real plate/pipe pieces it
// describes are their own BOM items elsewhere on the sheet. Deliberately narrow (one entry,
// added only once a real PMB pattern proved it needed this override) — never a speculative list.
const ALWAYS_CONFIG_LABELS = [/^chimney ?size:?$/];
export function isAlwaysConfigLabel(description) {
  return ALWAYS_CONFIG_LABELS.some(re => re.test(norm(description).toLowerCase()));
}

// --- value / unit -------------------------------------------------------------------------------------------------
// A configuration row is {label, value, unit}: "SET PRESSURE - I" = 10.54 KG/CM2(G). The unit is its own field so the
// input holds just the number. Units are a whitelist (like the label vocabulary): "0-21KG/CM2(G)" or "1250X2500" are not
// "number + unit" and stay as typed.
const UNIT_SRC = '(?:kg\\/cm2\\(g\\)|kg\\/cm²\\(g\\)|kg\\/cm2|kg\\/cm²|kg\\/hr|kg\\/h|kw|hp|rpm|cfm|cmh|cmph|cmm|m3\\/hr?|nm3\\/hr?|m³\\/hr?|mm ?wc|mmwc|inch ?wc|inchwc|in ?wc|wc|mwc|kpa|pa|bar|psi|mbar|tph|lpm|lph|gpm|l\\/s|cfs|°c|°f|mm|kgs?|"|\')';
const UNIT_RE = new RegExp(`^${UNIT_SRC}$`, 'i');
const NUM_UNIT_RE = /^(\d+(?:[.,]\d+)?)\s*(\S.*?)?$/;
const LABEL_UNIT_RE = new RegExp(`^(.*?)\\s*(?:\\(\\s*(${UNIT_SRC})\\s*\\)|\\s(${UNIT_SRC}))$`, 'i');

// Suggested unit for a label that does not carry one itself. Only where the unit is not in doubt.
const DEFAULT_UNITS = [[/^set ?pressure/i, 'KG/CM2(G)'], [/reliev\w* ?cap/i, 'Kg/hr'], [/^operating ?temp/i, '°C']];

// "10.54 KG/CM2(G)" -> {value:'10.54', unit:'KG/CM2(G)'}; "2400" -> {value:'2400', unit:''}; "COLD AIR" -> {value:'COLD AIR', unit:''}.
export function splitValueUnit(value) {
  const v = norm(value);
  const m = v.match(NUM_UNIT_RE);
  if (!m) return { value: v, unit: '' };
  if (!m[2]) return { value: m[1], unit: '' };
  return UNIT_RE.test(m[2]) ? { value: m[1], unit: m[2] } : { value: v, unit: '' };
}

// The one place a raw {label, value} becomes {label, value, unit}: the unit typed with the value wins, else the unit
// the label itself carries ("FLOW cfm", "OPERATING TEMP(°C)"), else the label's fixed default — the last two only when
// the value is a plain number (or still blank), never for text like "AMBIENT" or "CENTRIFUGAL".
export function configParts(labelRaw, valueRaw) {
  let label = norm(labelRaw).replace(/reliev\w*/i, 'RELIEVING').replace(/:$/, ''); // "RELIEVEING" spelling; a trailing colon ("CHIMNEY SIZE:") reads oddly once stored as a clean label
  let { value, unit } = splitValueUnit(valueRaw);
  let labelUnit = '';
  if (/^rpm$/i.test(label)) { label = 'SPEED'; labelUnit = 'RPM'; }
  else {
    const m = label.match(LABEL_UNIT_RE);
    if (m && m[1] && isConfigLabel(m[1])) { label = norm(m[1]); labelUnit = m[2] || m[3]; }
  }
  const plain = !value || /^\d+(?:[.,]\d+)?$/.test(value);
  if (!unit && plain) unit = labelUnit || (DEFAULT_UNITS.find(([re]) => re.test(label)) || [])[1] || '';
  return { label, value, unit };
}

const PROCUREMENT_FIELDS = ['pr_ref', 'po_ref', 'grn_qty_text', 'pending_qty_text', 'bqtc_ref', 'issued_ref', 'received_ref'];

// rec uses the same field names as the parser's row record and as a bom_items row, so the import parser and
// the in-app "convert existing items" action share one rule. Returns {label, value} or null.
// `anyLabel` skips the vocabulary check (rules 2-4 still apply): used only when a person explicitly picks an
// existing item to convert, so a label outside the fixed list (PHASE, VOLTAGE…) is still convertible while a
// row that carries real quantity/material/procurement data can never be converted by accident.
export function classifyConfigRow(rec, { anyLabel = false } = {}) {
  if (!rec || !norm(rec.material_description)) return null;
  const alwaysConfig = isAlwaysConfigLabel(rec.material_description);
  if (!anyLabel && !alwaysConfig && !isConfigLabel(rec.material_description)) return null;
  // SET PRESSURE is the one label where a quantity is not purchasing data: "SET PRESSURE - I ... 2 Nos" counts the
  // safety valves set to that pressure (the valve line itself carries the real quantity). Only for the real label
  // (never "SET PRESSURE GAUGE"). isAlwaysConfigLabel (CHIMNEY SIZE:) bypasses both the qty AND the MOC half of
  // this gate — its real moc/qty describe the assembly's overall geometry note, not a single purchasable line.
  const qtyIsNotPurchasing = alwaysConfig || (isConfigLabel(rec.material_description) && /^set ?pressure/i.test(norm(rec.material_description)));
  if ((norm(rec.qty_text) && !qtyIsNotPurchasing) || (norm(rec.moc) && !alwaysConfig)) return null;
  if (PROCUREMENT_FIELDS.some(f => norm(rec[f]))) return null;
  // grn_ref is a real procurement field too, except the "0000"/"0" placeholder some sheets pre-fill.
  const grn = norm(rec.grn_ref);
  if (grn && !/^0+$/.test(grn)) return null;
  const values = [rec.size_spec, rec.make, rec.remarks].map(norm).filter(Boolean);
  if (values.length > 1) return null;
  return configParts(rec.material_description, values[0] || '');
}

// "MIN RELIEVEING CAP - 1800 Kg/hr" — a config label and its value in ONE cell. Returns {label, value} only when
// the part before the dash/colon is a known datasheet label.
export function splitLabelValue(text) {
  const m = norm(text).match(/^(.{2,60}?)\s*[-–:]\s*(\S.*)$/);
  return m && isConfigLabel(m[1]) ? { label: norm(m[1]), value: norm(m[2]) } : null;
}

// Some sheets put the second line of a datasheet field on its own row with NO description and the text in the
// spec column (SET PRESSURE - I / next row: "MIN RELIEVEING CAP - 1800 Kg/hr"). Only that exact shape: nothing
// but the spec cell (and the status column) filled, and the text splits into a known label + value.
export function continuationConfig(rec) {
  if (!rec || norm(rec.material_description) || !norm(rec.size_spec)) return null;
  if (Object.keys(rec).some(k => k !== 'size_spec' && k !== 'purchase_status' && !k.startsWith('_') && norm(rec[k]))) return null;
  const sp = splitLabelValue(rec.size_spec);
  return sp && configParts(sp.label, sp.value);
}

// Tolerant read: NULL, empty or corrupt JSON -> []. Never throws.
export function parseConfig(json) {
  if (!json) return [];
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(e => e && typeof e === 'object' && norm(e.label))
      // Rows saved before units existed have no `unit` key ("FLOW cfm" = "2400"): split them on read, no migration.
      .map(e => (e.unit === undefined ? configParts(e.label, e.value) : { label: norm(e.label), value: norm(e.value), unit: norm(e.unit) }));
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
    if (norm(e.unit).length > CONFIG_LIMITS.unit) return `A unit is longer than ${CONFIG_LIMITS.unit} characters`;
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
    out.push({ label, value: norm(e?.value), unit: norm(e?.unit) });
  }
  return out;
}

// Storage form: '' / no rows -> NULL so an unconfigured node stays byte-identical to today.
export function serializeConfig(list) {
  const clean = normalizeConfig(list);
  return clean.length ? JSON.stringify(clean) : null;
}

// Merge incoming rows into an existing list (an import or a convert). Same label (case-insensitive): a
// non-empty incoming value (with its unit) replaces the old one, an empty incoming value never blanks an existing one;
// other rows are untouched and new labels are appended in order. Returns {list, added, updated}.
export function mergeConfig(existing, incoming) {
  const list = normalizeConfig(existing);
  const index = new Map(list.map((e, i) => [e.label.toLowerCase(), i]));
  let added = 0, updated = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const label = norm(raw?.label);
    if (!label) continue;
    const value = norm(raw?.value);
    const unit = norm(raw?.unit);
    const at = index.get(label.toLowerCase());
    if (at != null) {
      if (value && (list[at].value !== value || (unit && list[at].unit !== unit))) { list[at] = { ...list[at], value, unit: unit || list[at].unit }; updated++; }
    } else if (list.length < CONFIG_LIMITS.rows) {
      index.set(label.toLowerCase(), list.length);
      list.push({ label, value, unit });
      added++;
    }
  }
  return { list, added, updated };
}
