// lib/legacy-crm-import.mjs — pure parsing for the old CRM exports (2026-09-25), used by
// scripts/import-legacy-crm.mjs. Two files:
//   ProductData.csv — the old Product Master (one row per product).
//   export_N.csv    — the "Customer summary" report (one row per organization), split into parts,
//                     4 title lines before the header, some rows broken across lines.
// No DB import. Nothing here guesses: blank or 0.0 values that the old CRM uses for "not set" are
// stored as NULL (e.g. GST 0.0 would otherwise silently zero the tax on a quotation).
import { customerKey } from './customer-match.mjs';

export const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = v => { const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const posOrNull = v => { const n = num(v); return n && n > 0 ? n : null; };
const yn = v => (/^(y|yes|true)$/i.test(clean(v)) ? 1 : /^(n|no|false)$/i.test(clean(v)) ? 0 : null);

// Minimal CSV reader (quoted fields may contain commas/newlines). Like Python's csv module, a quote
// only starts quoting at the very start of a field; a quote mid-field (the export writes 3/4\" for
// inches) is a plain character, so one stray quote can't swallow the rest of the file.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false, start = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && start) { q = true; start = false; }
    else if (ch === ',') { row.push(field); field = ''; start = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; start = true;
    } else { field += ch; start = false; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const UNIT = { SET: 'Set', NOS: 'Nos', 'NOS.': 'Nos', MTRS: 'Mtr', MTR: 'Mtr', KGS: 'Kgs', LS: 'Lump Sum', 'LUM SUM': 'Lump Sum', 'PER DAY': 'Per Day' };

// Products. Codes shared by different products keep the first as-is; later ones get "CODE (2)"…
// (sales_products.product_code is UNIQUE); the original stays in legacy_code.
export function parseProducts(text) {
  const [head, ...body] = parseCsv(text);
  const h = head.map(clean);
  const col = name => h.findIndex(x => x.toLowerCase().startsWith(name.toLowerCase()));
  const c = {
    code: col('Product Code'), name: col('Product Name'), hsn: col('HSN'), category: col('Category'), desc: col('Description'),
    type: col('Type'), subType: col('SubType'), unit: col('Unit'), price: col('Price (in PC)'), cost: col('Cost Price'),
    gst: col('GST Rate'), warranty: col('Warranty Period'), upgradable: col('Upgradable'), spares: col('Spares Required'),
    pit: col('Pit Marking'), calibration: col('Calibration'), serviceable: col('Serviceable'),
  };
  const seen = new Map(); const products = []; const issues = { sharedCodes: [], noCode: 0, zeroPrice: 0, zeroGst: 0 };
  for (const r of body) {
    if (r.length < h.length || !clean(r[c.name])) continue;
    const legacy = clean(r[c.code]) || null;
    let code = legacy;
    if (legacy) {
      const n = (seen.get(legacy.toUpperCase()) || 0) + 1;
      seen.set(legacy.toUpperCase(), n);
      if (n > 1) { code = `${legacy} (${n})`; issues.sharedCodes.push(`${legacy}: ${clean(r[c.name])}`); }
    } else issues.noCode++;
    const price = posOrNull(r[c.price]); if (!price) issues.zeroPrice++;
    const gst = posOrNull(r[c.gst]); if (!gst) issues.zeroGst++;
    const unitRaw = clean(r[c.unit]).toUpperCase();
    const attrs = {};
    for (const [k, i] of [['upgradable', c.upgradable], ['spares_required', c.spares], ['pit_marking', c.pit], ['calibration', c.calibration]]) {
      const v = yn(r[i]); if (v != null) attrs[k] = !!v;
    }
    if (clean(r[c.subType])) attrs.sub_type = clean(r[c.subType]);
    products.push({
      product_code: code, legacy_code: legacy, product_name: clean(r[c.name]),
      product_type: clean(r[c.type]) || null, category: clean(r[c.category]) || null,
      description: clean(r[c.desc]) || null, unit: UNIT[unitRaw] || clean(r[c.unit]) || null,
      hsn_code: clean(r[c.hsn]) || null, price, cost_price: posOrNull(r[c.cost]), gst_pct: gst,
      warranty_days: posOrNull(r[c.warranty]), serviceable: yn(r[c.serviceable]),
      attributes_json: Object.keys(attrs).length ? JSON.stringify(attrs) : null,
    });
  }
  return { products, issues };
}

// Old CRM stage spellings -> this app's funnel stages.
const STAGES = [
  [/LEAD\s*-\s*COLD/, 'Lead - Cold'], [/LEAD\s*-\s*HOT/, 'Lead - Hot'], [/LEAD PROJECT\s*-\s*DROPED/, 'Lead Project - Dropped'],
  [/PROPOSALS/, 'Proposals'], [/HOT OFFERS/, 'Hot Offers'], [/ORDER RECEIVED/, 'Order Received'], [/ORDER LOST/, 'Order Lost'],
  [/OEM FOLLOW UPS MONTHLY/, 'OEM Follow Ups Monthly'], [/FOLLOW UP STAGE/, 'Follow up stage'],
];
const STAGE_RE = /(\d+)\s*(LEAD\s*-\s*COLD|LEAD\s*-\s*HOT|LEAD PROJECT\s*-\s*DROPED|PROPOSALS|HOT OFFERS|ORDER RECEIVED|ORDER LOST|OEM FOLLOW UPS MONTHLY|FOLLOW UP STAGE)/g;
export function parseStageCounts(s) {
  const out = {};
  for (const [, n, raw] of clean(s).matchAll(STAGE_RE)) {
    const name = STAGES.find(([re]) => re.test(raw))[1];
    if (+n) out[name] = (out[name] || 0) + +n;
  }
  return out;
}

const splitList = v => clean(v).split(/\s*,\s*/).map(clean).filter(Boolean);

// Customer summary rows (all export parts). Rows with the wrong column count (a Products/Funnel
// cell that broke the CSV) are returned in `broken` for the issues report, never guessed.
export function parseCustomerSummary(text, fileLabel) {
  const rows = parseCsv(text);
  const hi = rows.findIndex(r => clean(r[0]) === 'S.N.');
  if (hi < 0) throw new Error(`${fileLabel}: header row "S.N." not found`);
  // Rejoin records: a line that doesn't start with an S.N. continues the previous record (a line
  // break inside a cell). A record with too many columns had unquoted commas in Products — its first
  // 5 and last 9 columns are fixed, so the middle is Products.
  const records = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r.some(x => clean(x))) continue;
    if (/^\d+$/.test(clean(r[0])) || !records.length) records.push([...r]);
    else { const cur = records[records.length - 1]; cur[cur.length - 1] += ' ' + r[0]; cur.push(...r.slice(1)); }
  }
  const out = []; const broken = [];
  for (let r of records) {
    if (r.length > 15) { r = [...r.slice(0, 5), r.slice(5, r.length - 9).join(','), ...r.slice(r.length - 9)]; r.recovered = true; }
    const calls = (num(r[3]) || 0) + (num(r[4]) || 0);
    const stageTotal = r.length === 15 ? Object.values(parseStageCounts(r[6])).reduce((a, b) => a + b, 0) : -1;
    // A recovered row must still add up: its stage counts equal its open + closed calls.
    if (r.length !== 15 || !/^\d+$/.test(clean(r[0])) || (r.recovered && stageTotal !== calls)) {
      broken.push({ file: fileLabel, text: clean(r.join(',')).slice(0, 160) }); continue;
    }
    out.push({
      sn: +clean(r[0]), code: clean(r[1]) || null, name: clean(r[2]),
      open_calls: num(r[3]) || 0, closed_calls: num(r[4]) || 0,
      products: splitList(r[5]), stages: parseStageCounts(r[6]), managers: splitList(r[7]),
      district: clean(r[8]) || null, quote_total: num(r[9]) || 0, orders: num(r[10]) || 0,
      order_value: num(r[11]) || 0, collection: num(r[12]) || 0, amc: num(r[13]) || 0, amc_value: num(r[14]) || 0,
      file: fileLabel,
    });
  }
  return { rows: out, broken };
}

// Group summary rows into customers. Merge only when certain: same organization code, or the same
// multi-word name key (suffixes/"M/s" ignored) where neither the codes nor the districts conflict. Single-word names
// ("Anil", "Buyer") are people — never merged on name alone.
export function groupCustomers(rows) {
  const groups = []; const byCode = new Map(); const byKey = new Map();
  for (const r of rows) {
    const key = customerKey(r.name);
    let g = (r.code && byCode.get(r.code)) || null;
    if (!g && key.includes(' ')) {
      const cand = byKey.get(key);
      const dist = v => clean(v).toLowerCase();
      const districtClash = cand?.district && r.district && dist(cand.district) !== dist(r.district);
      if (cand && (!r.code || cand.codes.size === 0) && !districtClash) g = cand;
    }
    if (!g) { g = { names: [], codes: new Set(), rows: [], key }; groups.push(g); if (key.includes(' ') && !byKey.has(key)) byKey.set(key, g); }
    g.rows.push(r); g.names.push(r.name); if (!g.district && r.district) g.district = r.district;
    if (r.code) { g.codes.add(r.code); byCode.set(r.code, g); }
  }
  return groups.map(g => {
    const sum = k => g.rows.reduce((a, r) => a + (r[k] || 0), 0);
    const stages = {};
    for (const r of g.rows) for (const [k, v] of Object.entries(r.stages)) stages[k] = (stages[k] || 0) + v;
    const uniq = a => [...new Set(a)];
    return {
      name: g.names[0], key: g.key, codes: [...g.codes], district: g.rows.find(r => r.district)?.district || null,
      managers: uniq(g.rows.flatMap(r => r.managers)), products: uniq(g.rows.flatMap(r => r.products)),
      summary: {
        open_calls: sum('open_calls'), closed_calls: sum('closed_calls'), stages,
        quote_total: sum('quote_total'), orders: sum('orders'), order_value: sum('order_value'), collection: sum('collection'),
        amc: sum('amc'), amc_value: sum('amc_value'), merged_rows: g.rows.length, other_names: uniq(g.names.slice(1)),
      },
    };
  });
}
