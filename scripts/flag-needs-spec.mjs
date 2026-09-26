// Sets bom_items.needs_spec (a note naming the missing field) on lines still un-linked to the Item Master because the
// source lacks something. Never touches the description/spec, never splits, never creates Item Master rows. Linking a line
// later clears the note (lib/item-link.js). Dry-run by default.  node --env-file=.env.local scripts/flag-needs-spec.mjs [--apply]
import { createClient } from '@libsql/client';
const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const n = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const SKIP = r => /TEST-STORES|UI-VERIFY|GAP-FIX TEST|LIVE TEST/i.test(r.d) || /FOUNDATION BOLT & NUT/i.test(r.d) || /^MS SQUARE ROD$/i.test(n(r.d))
  || /^(TYPE|FLOW.*|STATIC HEAD.*|SPEED.*|MEDIUM|OPERATING TEMP.*|SET PRESSURE.*|TYPE OF MOUNTING|AS PER DWG|EXTRA|FABRIC WEIGH|SCALE|NO OF .*|SIZE AIR FLOW.*|TEMP.*|HIGH DIFFERENTIAL.*)$/i.test(n(r.d).replace(/ ?:$/, '')) || /MOTOR RATING/i.test(r.d);
const RULES = [
  [/^LUGS$/i, 'Lug type (pin/fork/ring) and size, or the cable size it is for'],
  [/LIFTING HOOKS?\b(?! PAD)/i, r => /THK/i.test(r.s) ? 'Hook thickness: 25 or 20 mm?' : 'Hook dimensions and safe working load'],
  [/^C CHANNEL$/i, 'Channel section (e.g. ISMC 75x40 / 100x50)'],
  [/STRUCTURE WITH BASE PLATE/i, 'ISA 75x75 thickness (6, 8 or 10 mm)'],
  [/^REDUCER$/i, 'Reducer inlet/outlet sizes and length'],
  [/CAN ?VAS/i, 'Canvas cloth dimensions'],
  [/END CAP/i, 'Schedule: SCH-40 or SCH-80'],
  [/^SAFETY VALVE F\/E/i, 'Outlet size and set pressure'],
  [/CASTABLE REFRACTORY$/i, 'Castable grade and bag size for the stated volume'],
  [/^FIRECLAY/i, 'Product: fireclay or INSULYTE-7?'],
  [/CABLE GLAND/i, 'Gland sizes (PG) / cable outside diameter'],
  [/RECTANGLE/i, 'Thickness and length'],
  [/^SS CONE/i, 'Cone dimensions (source says "as per drawing")'],
  [/^APH TO MDC/i, 'Duct size and thickness'],
  [/VENTURY/i, 'Venturi size'],
  [/^CHIMNEY FOUNDATION TEMPLATE/i, 'Thickness: 3 or 2 mm?'],
  [/CONDENSATE RECO/i, 'Buy as a one-off item, or create an Item Master row? (name/spec)'],
];
const rows = (await db.execute(`SELECT b.id,b.material_description d,b.moc,b.size_spec s,b.needs_spec FROM bom_items b JOIN projects p ON p.id=b.project_id WHERE b.source='bom' AND b.item_id IS NULL AND p.status='active'`)).rows.map(r => ({ ...r }));
let set = 0, same = 0; const by = {};
for (const r of rows) {
  if (SKIP(r)) continue;
  let note = null;
  for (const [re, a] of RULES) if (re.test(r.d)) { note = typeof a === 'function' ? a(r) : a; break; }
  note ||= 'Sizes and quantities in this line do not pair one-to-one — which quantity goes with which size?';
  if (r.needs_spec === note) { same++; continue; }
  by[note] = (by[note] || 0) + 1; set++;
  if (apply) await db.execute({ sql: 'UPDATE bom_items SET needs_spec = ? WHERE id = ?', args: [note, r.id] });
}
console.log(apply ? 'flagged' : 'would flag', set, 'lines;', same, 'already set'); console.log(by);
if (apply) await db.execute({ sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:needs-spec-2026-09-26', 'needs_spec_flagged', ?)", args: [JSON.stringify({ lines: set })] });
