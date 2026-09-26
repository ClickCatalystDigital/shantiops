// Decision rules for the Item Master residue pass. One rule = one family of lines with a clear precedent in the data:
// how the same kind of line was already linked (see the existing bom_items.item_id links), or how the catalog names its rows.
// A rule returns {link:'EXACT CATALOG NAME'} | {create:{name,group,bom_category,uom,moc?,fields?,mfg?,detail?}} |
//                {leave:'reason'} | {config:true}  or undefined (rule does not apply).
// line = {desc, moc, size, category, count, projects}
import { nbsOf, inchOfNb } from './lib-boi-match.mjs';

const U = s => String(s ?? '').toUpperCase().replace(/[“”″]/g, '"').replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const all = l => U(`${l.desc} ${l.moc} ${l.size}`);
const inch = nb => { const i = inchOfNb(nb); return i ? `${i}"` : null; };
export const linkTo = name => ({ link: name });
const create = spec => ({ create: spec });

// Thickness written as 5T / 5TH / 5 THK / 5THK. / 5 MM THICK; returns Number | null. Only the LAST number before the marker counts.
export function thkOf(text) {
  const t = U(text);
  const m = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:MM\s*)?(?:THK|THICK|TH\b|T\b)/g)];
  return m.length ? Number(m[m.length - 1][1]) : null;
}
const numsIn = s => [...String(s).matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));

export const RULES = [
  // ---- reviewed 2026-09-26: fully specified real parts the catalog lacked, and lines whose answer exists in other projects ----
  { name: 'reviewed-extra', test: () => true, do: l => {
    const a = `${l.desc} | ${l.moc} | ${l.size}`.toUpperCase().replace(/\s+/g, ' ');
    const mk = (name, group, mfg, extra = {}) => create({ name, group, bom_category: 'other', uom: 'Nos', mfg, ...extra });
    if (/^MDC CONES/.test(a) && /9 ?" ?X 450/.test(a)) return mk('MDC CONE, CI, 9" X 450 HT, WITH VANES', 'MISSLANIOUS', 0, { moc: 'CI' });
    if (/^MDC CONES/.test(a) && /9 ?" ?X 850/.test(a)) return mk('MDC CONE, CI, 9" X 850 HT, WITH VANES', 'MISSLANIOUS', 0, { moc: 'CI' });
    if (/^SG BOLT FLANGE/.test(a) && /DIA 165 X 16 THK/.test(a)) return mk('SG BOLT FLANGE, DIA 165 X 16 THK', 'MISSLANIOUS', 1);
    if (/^CHIMNEY FOUNDATION \(DOUBLE NUT AND BOLT/.test(a) && /M25 X 900/.test(a)) return mk('CHIMNEY FOUNDATION BOLT, DOUBLE NUT, MS, M25 X 900 LG', 'FASTENERS', 0, { moc: 'MS' });
    if (/^CHIMNEY FOUNDATION \(DOUBLE NUT AND BOLT/.test(a) && /M32 X 1500/.test(a)) return mk('CHIMNEY FOUNDATION BOLT, DOUBLE NUT, MS, M32 X 1500 LG', 'FASTENERS', 0, { moc: 'MS' });
    if (/^REDUCER \| MS \| 300NBX250NBX220 LG X 3\.15T/.test(a)) return mk('REDUCER, MS, 300 NB X 250 NB X 220 LG X 3.15 THK (FABRICATED)', 'MISSLANIOUS', 1, { moc: 'MS' });
    if (/^CROSS HEADER \| CS \| 5"/.test(a)) return mk('CROSS HEADER, CS, 5" (125 NB)', 'MISSLANIOUS', 1, { moc: 'CS' });
    if (/^PIN \| \| DIA 60 (\/|X) DIA 25 X (112|152) LG/.test(a)) return mk(`PIN STEPPED, DIA 60 / DIA 25 X ${/112/.test(a) ? 112 : 152} LG`, 'MISSLANIOUS', 1);
    // answers already decided for the same part on other projects
    if (/^FIRE DOOR \(BIG\) \| CI \| STD$/.test(a)) return linkTo('FIRE DOOR (BIG) CI, FRAME 740 X 640');
    if (/^BEARINGS \| SS \| 22209K$/.test(a)) return linkTo('BEARINGS SPIRAL ROLLER 22209-K');
    if (/^KEY WAY ROD \| \| 8 X 8 - 300 LG$/.test(a)) return linkTo('KEY ROD 8 MM X 8 MM X 300 L');
    if (/^MS STRUCTURE (WORK|SUPPORT) \| MS(- IS 2062)? \| ISMC ?100 ?X ?50$/.test(a)) return linkTo('MS CHANELS ISMC 100 X 50');
    if (/^MS STRUCTURE (WORK|SUPPORT) \| MS(- IS 2062)? \| ISA ?50 ?X ?50( X5T?H?K?)?$/.test(a)) return linkTo('MS ANGLE 50 X 50 X 5 MM'); // 5 mm: same PMB family writes X5thk (approved 2026-09-26)
  } },
  { name: 'test-row', test: l => /SAFE TO IGNORE|UI-VERIFY|GAP-FIX TEST|LIVE TEST|TEST-STORES/i.test(`${l.desc} ${l.moc}`), do: () => ({ leave: 'test / demo row created during verification — not a real requirement' }) },
  // ---- the description IS a catalog item name (people picked it from the Item Master) -------------------------------
  { name: 'exact-name', test: () => true, do: (l, c) => { const r = c.byName(l.desc); return r ? linkTo(r.item_name) : undefined; } },

  // ---- not items: datasheet / configuration rows -------------------------------------------------------------------
  { name: 'datasheet-row', test: l => /^(TYPE|FLOW ?CFM|STATIC HEAD.*|SPEED RPM|MEDIUM|OPERATING TEMP.*|SET PRESSURE.*|TYPE OF MOUNTING|LENGTH|DIAMETER|RING SPACING|SCALE|SIZE AIR FLOW.*|AIR PERMEABILITY.*|SURFACE FINSH|SURGE.*|TEMPERATURE WITH STAND.*|TEMP ABOVE SET.*|TEMP BELOW SET.*|HIGH DIFFERENTIAL.*|EXTRA|AS PER DWG|FOR BLOW DOWN LINE|CLAMPING ARRANGMENT.*|NO OF CHANNELS|TUBE SHEET DIA|CHIMNEY SIZE:?|EFFICIENCY OF FILTER BAG|NO OF FILTER BAG|FABRIC WEIGH|SUFRACE FINSH|SURFACE FINISH)$/i.test(U(l.desc).replace(/ ?:$/, '')),
    do: () => ({ config: true, why: 'datasheet / specification row (fan, pump, valve or chimney data) — configuration of the node, not something to buy' }) },

  // ---- gaskets: metallic / non-metallic by nozzle NB ---------------------------------------------------------------
  { name: 'gasket-by-nb', test: l => /GASKET/.test(U(l.desc)) && !/RUBBER|SG GASKET|WLG|FOR PUMP|SET/.test(U(l.desc)),
    do: (l, c) => {
      const nbs = [...new Set(nbsOf(l.size).length ? nbsOf(l.size) : nbsOf(l.desc))];
      if (nbs.length > 1) return { leave: `bundled: one line lists ${nbs.length} gasket sizes (${nbs.join(' / ')} NB) — needs a human split` };
      if (!nbs.length) return;
      const nb = nbs[0];
      const metallic = /METAL+IC/.test(all(l)) && !/NON[- ]?METAL/.test(all(l));
      const rows = c.find(metallic ? new RegExp(`^ASBESTOS (?:CUT )?GASKET[- ]METALIC ${nb} MM`) : new RegExp(`^ASBESTOS CUT GASKET NON-METALIC ${nb} MM`));
      return rows.length === 1 ? linkTo(rows[0].item_name) : undefined;
    } },
];

// ---- chunk A: flanges, pipes, fabricated plate ---------------------------------------------------------------------
const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const flangeName = (dummy, tail) => `${dummy ? 'DUMMY FLANGES' : 'FLANGES'}, MS, ${tail}`;
RULES.push({
  name: 'flange-by-nb',
  test: l => /FLANGE|BLIND|IBR BLIND/.test(U(l.desc)) && !/GASKET|BOLT|FLANGES MATERIAL/.test(U(l.desc)),
  do: (l, c) => {
    const d = U(l.desc), a = all(l);
    const nbs = [...new Set(nbsOf(l.size).length ? nbsOf(l.size) : nbsOf(l.desc))];
    if (!nbs.length) return; // a plate-cut ring (OD x ID x THK) — the plate rule takes it
    if (nbs.length > 1) return { leave: `bundled: one line lists ${nbs.length} flange sizes (${nbs.join(' / ')} NB) — needs a human split` };
    const nb = nbs[0], inc = inch(nb);
    const dummy = /\(FLANGE/.test(d) ? false : /DUMM[EY]|COVER FLANGE|IBR BLIND|BLIND|BLANK/.test(d);
    const ibrWord = /\bNIBR|NON[- ]?IBR/.test(a) ? 'NON-IBR' : 'IBR';
    let tail;
    if (/#\s*150|150 ?#|CLASS[- ]?150|ANSI/.test(a)) tail = `CLASS-150, NON-IBR-${nb} MM`;
    else if (/#\s*300|300 ?#|CLASS[- ]?300/.test(a)) tail = `CLASS-300, ${ibrWord === 'IBR' ? 'IBR ' : 'NON-IBR-'}${nb} MM`;
    else if (/TABLE ?-? ?'?H|\bT[-\/]H\b|BS ?-? ?10|OD \d+(\.\d+)? ?X ?ID/.test(a)) tail = `T/H, ${ibrWord === 'IBR' ? 'IBR ' : 'NON-IBR-'}${nb} MM`;
    else if (/\bT[-\/]E\b|TABLE ?-? ?'?E\b/.test(a)) tail = `T/E, ${ibrWord === 'IBR' ? 'IBR ' : 'NON-IBR-'}${nb} MM`;
    else return;
    const re = new RegExp('^' + esc(flangeName(dummy, tail.replace(/ MM$/, ' MM'))) );
    const rows = c.find(re);
    if (rows.length === 1) return linkTo(rows[0].item_name);
    // catalog has no such row: create it with the family's naming
    const t = tail.replace(` ${nb} MM`, ` ${nb} MM (${inc?.replace(/ /g, '').replace(/^(\d)(\d\/\d)/, '$1$2') ?? ''})`);
    return create({ name: flangeName(dummy, `${tail} (${(inch(nb) || '').replace(/^(\d) (\d\/\d)/, '$1$2')})`), group: dummy ? 'DUMMY FLANGES' : 'FLANGES', bom_category: 'standard', uom: 'Nos', mfg: 0 });
  },
});

RULES.push({
  name: 'pipe-by-nb',
  test: l => (l.category === 'pipe' || /PIPE|NECK|STUB|HEADER|RING\b/.test(U(l.desc))) && !/CHIMNEY|FLANGE|VALVE|GASKET|BLIND|BEND|ELBOW|COUPLING|NIPPLE|REDUCER|EXPANDER|\bCAP\b|SLEEVE|TUBE SHEET|PIPE BEND|CLAMP|HOSE|SENSOR|BRUSH|GAUGE|LEVEL INDICATOR|T ?- ?JOINT|SYPHON|SIPHON/.test(U(l.desc)) && !/BS ?3059|BS ?6323|ERW/.test(all(l)),
  do: (l, c) => {
    const a = all(l);
    const nbs = [...new Set(nbsOf(l.size).length ? nbsOf(l.size) : nbsOf(l.desc))];
    if (nbs.length !== 1) return;
    const nb = nbs[0], inc = inch(nb);
    if (/\bSS\b|SS ?304/.test(U(l.moc))) return create({ name: `SS PIPE 304 SCH-40 ${nb} NB (${inc})`, group: 'SS PIPE', bom_category: 'pipe', uom: 'Nos', moc: 'SS 304', mfg: 0 });
    if (/SMLS|SEAMLESS|SA ?106|SCH[- ]?(40|80)/.test(a)) {
      const sch = /SCH[- ]?80/.test(a) ? 80 : 40;
      const rows = c.find(new RegExp(`^SEAMLESS PIPE SCH ?${sch} IBR ${nb} ?MM`));
      return rows.length === 1 ? linkTo(rows[0].item_name) : undefined;
    }
    if (/'?\s?B'? ?CL(ASS)?\b|\bB CLASS|MS 'B'|B "CLASS/.test(a) || /^MS/.test(U(l.moc)) || /^MS\b/.test(U(l.desc))) {
      const rows = c.find(new RegExp(`^MS PIPE B CLASS ${esc(inc.replace('"', ''))} ?"$`));
      return rows.length === 1 ? linkTo(rows[0].item_name) : undefined;
    }
  },
});

// Fabricated parts cut from plate (brackets, pads, covers, shells, cones ...): the thing to buy is the plate of that thickness.
export function allThk(text) {
  const t = U(text).replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?=(?:MM\s*)?(?:THK|THICK|TH\b|T\b))/g, '$1 OR $2 ');
  const out = new Set();
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(?:\s*OR\s*(\d+(?:\.\d+)?))?\s*(?:MM\s*)?(?:THK|THICK|TH\b|T\b)/g)) { out.add(Number(m[1])); if (m[2]) out.add(Number(m[2])); }
  return [...out];
}
const PLATEISH = /SHEET|PLATE|COVER|PAD\b|BRACKET|STRIP|HOOK|FLANGE|LUG|GUSSET|RIB|SADDLE|SHELL|CONE|TANK|DUCT|BEND|FG-|FGB|FGR|REDUCER|TEMPLATE|RING|NECK|MANHOLE|SG |BOILER TO|APH TO|MDC TO|ID FAN TO/;
RULES.push({
  name: 'plate-by-thickness',
  test: l => {
    const d = U(l.desc), m = U(l.moc), z = U(l.size);
    if (/SHAFT|PIN\b|ROD|BOLT|PIPE|(?<!SHEET )TUBE(?!S? SHEET)|GRILL|FLAT\b|WOODEN|HYLAM|CLADDING|CORRUGATE|CHEQUER|CHQUER|ALUMIN|\bGI\b|\bSS\b|GAUGE|GLASS|CANVAS|CASTABLE|BRICK|CABLE|PUMP|MOTOR|\\bANGLE\\b|\\bCHANNEL\\b|STRUCTURE/.test(`${d} ${m}`)) return false;
    if (/ISMC|ISA ?\d|ISMB|ISF|ISLB/.test(z)) return false;
    if (/^(SS|ALU|GI)/.test(m)) return false;
    if (nbsOf(l.size).length) return false;
    const msish = /MS|IS ?2062|MILD STEEL/.test(m);
    if (!msish && !(m === '' && PLATEISH.test(d) && /\d+\s*X\s*\d+/i.test(z))) return false;
    return allThk(`${l.size} ${l.desc}`).length > 0;
  },
  do: (l, c) => {
    const ts = allThk(`${l.size} ${l.desc}`);
    if (ts.length > 1) return { leave: `bundled or ambiguous thickness (${ts.join(' / ')} mm) in one line — needs a human decision or split` };
    const t = ts[0];
    const rows = c.find(new RegExp(`^MS PLATES ${esc(String(t))} MM$`));
    if (rows.length === 1) return linkTo(rows[0].item_name);
    return create({ name: `MS PLATES ${t} MM`, group: 'MS PLATES', bom_category: 'plate', uom: 'Kgs', moc: 'MS', fields: { thickness: t }, mfg: 1 });
  },
});

// ---- chunk B: flats, angles, channels ---------------------------------------------------------------------------------
RULES.push({
  name: 'flat-by-size',
  test: l => /FLAT|FIN\b|STRIP|RECTANGLE/.test(U(l.desc)) && !/FLANGE|GASKET|CABLE|TRAP/.test(U(l.desc)) && /(\d+(?:\.\d+)?)\s*(?:MM)?\s*X\s*(\d+(?:\.\d+)?)\s*(?:T\b|THK|MM)?/.test(U(l.size)) && !/^(SS|ALU|GI|CU|COPPER)/.test(U(l.moc)),
  do: (l, c) => {
    const m = U(l.size).match(/(\d+(?:\.\d+)?)\s*(?:MM)?\s*X\s*(\d+(?:\.\d+)?)\s*(?:T\b|THK|MM|\s|$)/);
    if (!m) return;
    const [w, t] = [Number(m[1]), Number(m[2])];
    if (!(w > t) || t > 30) return;
    const rows = c.find(new RegExp(`^MS FLATE? ${w}(?: MM)? X ${t}(?:[ /]|$)`));
    if (rows.length === 1) return linkTo(rows[0].item_name);
    if (rows.length > 1) return;
    return create({ name: `MS FLAT ${w} MM X ${t} MM`, group: 'MS FLAT', bom_category: 'flat', uom: 'Kgs', moc: 'MS', fields: { width: w, thickness: t, density: 7850 }, mfg: 1 });
  },
});

// Rolled sections named in the size cell: ISA 50x50x5 / ISMC 100 x 50 (the size-key matcher misses the "ISA40X5T" style)
RULES.push({
  name: 'angle-channel',
  test: l => /ISA|ISMC/.test(U(l.size)) && !/ISMC[^A-Z]*\d+[^A-Z]*ISA|ISA[^A-Z]*\d+[^A-Z]*ISMC/.test(U(l.size)) && !/STRUCTURE/.test(U(l.desc)),
  do: (l, c) => {
    const z = U(l.size);
    let m = z.match(/ISMC\s*(\d+)\s*X\s*(\d+)/);
    if (m) {
      const rows = c.find(new RegExp(`^MS CHANELS ISMC ${m[1]} X ${m[2]}$`));
      if (rows.length === 1) return linkTo(rows[0].item_name);
      if (!rows.length) return create({ name: `MS CHANELS ISMC ${m[1]} X ${m[2]}`, group: 'MS CHANNEL', bom_category: 'channel', uom: 'Kgs', moc: 'MS', fields: { size: `ISMC ${m[1]}x${m[2]}` }, mfg: 1 });
      return;
    }
    m = z.match(/ISA\s*(\d+)\s*X\s*(\d+)?\s*X?\s*(\d+)?/);
    if (m && m[3]) {
      const rows = c.find(new RegExp(`^MS ANGLE ${m[1]} X ${m[2]} X ${m[3]} MM$`));
      if (rows.length === 1) return linkTo(rows[0].item_name);
    }
  },
});

// ---- chunk C: bolts / fasteners ---------------------------------------------------------------------------------------
const FRAC = '\\d+(?: \\d\\/\\d)?(?:\\/\\d)?';
function boltPairs(size) {
  const z = U(size).replace(/''/g, '"').replace(/(\d)\s*"/g, '$1"').replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');
  const out = [];
  for (const m of z.matchAll(new RegExp(`(${FRAC})"?\\s*(?:[X-]|-)\\s*(${FRAC})\\s*("|MM|LG)?`, 'g'))) out.push({ dia: m[1].trim(), len: m[2].trim(), mm: m[3] !== '"' && Number(m[2]) >= 25 && !m[2].includes('/') && !/ /.test(m[2]) && m[3] !== '"' });
  return out;
}
const mmToInch = mm => ({ 25: '1', 40: '1 1/2', 50: '2', 65: '2 1/2', 75: '3', 90: '3 1/2', 100: '4', 125: '5', 150: '6' }[mm]);
RULES.push({
  name: 'bolt-by-size',
  test: l => /BOLT|FASTENER|SCREW/.test(U(l.desc)) && !/I-BOLT|INSULATOR|SG BOLT|SELF SCREW|FOUNDATION|ANCHOR|CHIMNEY|FEEDER/.test(U(l.desc)),
  do: (l, c) => {
    const a = all(l), z = U(l.size);
    const metric = z.match(/^M(\d+)\s*X\s*(\d+(?:\/\d+)?)(?:\s*"|\s*LG|\s*MM)?\.?$/);
    if (metric) {
      const rows = c.find(new RegExp(`^(?:GI )?BOLTS M${metric[1]} X ${esc(metric[2])}(?: MM|")`));
      const gi = /\bGI\b/.test(U(l.moc));
      const pick = rows.filter(r => /^GI /.test(r.item_name) === gi);
      return pick.length === 1 ? linkTo(pick[0].item_name) : undefined;
    }
    const pairs = boltPairs(l.size);
    if ((U(l.size).replace(/''/g, '"').match(/"/g) || []).length > 2 && pairs.length <= 1) return { leave: 'bundled: one line lists several bolt sizes — needs a human split' };
    if (pairs.length > 1) return { leave: `bundled: one line lists ${pairs.length} bolt sizes (${pairs.map(p => `${p.dia}" x ${p.len}"`).join(', ')}) — needs a human split` };
    if (pairs.length !== 1) return;
    let { dia, len } = pairs[0];
    if (/LG|MM/.test(z) && !len.includes('/') && !/ /.test(len) && Number(len) >= 25) len = mmToInch(Number(len)) || len;
    const gi = /\bGI\b/.test(U(l.moc));
    const ht = /GRADE 8\.8|H\.T\.|HIGH TENSILE/.test(a);
    if (ht) { const r = c.find(new RegExp(`^HIGH TENSILE BOLTS & NUTS GRADE 8\\.8 ${esc(dia)}" X ${esc(len)}"`)); return r.length === 1 ? linkTo(r[0].item_name) : undefined; }
    const rows = c.find(new RegExp(`^${gi ? 'GI ' : ''}BOLTS[- ]${esc(dia)}" ?X ?${esc(len)}"$`));
    if (rows.length === 1) return linkTo(rows[0].item_name);
    if (rows.length > 1) return;
    return create({ name: `${gi ? 'GI ' : ''}BOLTS ${dia}" X ${len}"`, group: gi ? 'GI BOLTS' : 'FASTENERS', bom_category: 'standard', uom: 'Nos', mfg: 0 });
  },
});

// Flange blanks are bought as pressure-part plate of that thickness (how "FLANGES MATERIAL" lines were already linked).
RULES.push({
  name: 'flanges-material-bq',
  test: l => /FLANGES MATERIAL/.test(U(l.desc)) && /SA ?516/.test(U(l.moc)),
  do: (l, c) => {
    const nbs = [...new Set(nbsOf(l.size))];
    const ts = allThk(l.size);
    if (nbs.length > 1) return { leave: `bundled: one line lists ${nbs.length} flange sizes (${nbs.join(' / ')} NB) — needs a human split` };
    if (ts.length !== 1) return;
    const bq = c.find(/^BQ PLATE \d/).map(r => ({ r, t: Number(r.item_name.match(/^BQ PLATE (\d+(?:\.\d+)?)/)[1]) }));
    const best = bq.sort((a, b) => Math.abs(a.t - ts[0]) - Math.abs(b.t - ts[0]))[0];
    return best ? linkTo(best.r.item_name) : undefined;
  },
});

// ---- chunk D: valves, boiler mountings, fittings, instruments -------------------------------------------------------
const one = (c, re) => { const r = c.find(re); if (r.length > 1 && new Set(r.map(x => x.item_name)).size === 1) return r.sort((a, b) => a.id - b.id)[0]; return r.length === 1 ? r[0] : null; };
const sizeNb = l => { const n = [...new Set(nbsOf(l.size).length ? nbsOf(l.size) : nbsOf(l.desc))]; return n; };
const mkStd = (name, group) => create({ name, group, bom_category: 'standard', uom: 'Nos', mfg: 0 });
const tableH = a => /TABLE ?-? ?'?H|\bT[-\/]H\b|BS ?-? ?10/.test(a);

RULES.push({
  name: 'valve-family',
  test: l => /VALVE|ISO VALVE|STRAINER|MOISTURE SEP|SAFETY V|NRV|\bPRV\b|AIR VENT/.test(U(l.desc)) && !/GASKET|BOLT|FLANGE|SOLENOID|NEEDLE|MOBERY CONTROL|PISTON FOR|UI-VERIFY|REQUIRING QC|LIVE TEST|WITH GATE/.test(U(l.desc)),
  do: (l, c) => {
    const d = U(l.desc), a = all(l), m = U(l.moc);
    const nbs = sizeNb(l);
    if (!nbs.length) return;
    const nb = nbs[0];
    const cs = /\bC\.?S\b|CAST STEEL|CS\b/.test(m) || /\bC\.S\b/.test(m);
    const ci = /\bC\.?I\b|SGI|CI\//.test(m);
    const sgiOnly = /SGI/.test(m) && !/\bC\.?I\b/.test(m.replace(/SGI/g, ''));
    const forged = /FORGED/.test(m);
    const ibr = /\bNIBR|NON[- ]?IBR/.test(a) ? 'NON-IBR' : 'IBR';
    if (/SAFETY V/.test(d)) {
      const two = a.match(/(\d+)\s*X\s*(\d+)\s*MM/);
      if (/BRONZE|GUN METAL/.test(m)) { const r = one(c, new RegExp(`^SAFETY VALVE, BRONZE, S/E, NON-IBR ${nb} NB`)); return r ? linkTo(r.item_name) : undefined; }
      if (two) { const r = one(c, new RegExp(`^SAFETY V/E, CS, F/E, IBR ${two[1]} NB X ${two[2]} NB T/H$`)); return r ? linkTo(r.item_name) : undefined; }
      return { leave: 'safety valve: outlet size / set pressure not stated in the line — needs Engineering to complete the line' };
    }
    if (/GLOBE|ISO VALVE|AIR VENT|INLET VALVE/.test(d)) {
      if (forged && (/#\s*(800|3000)|SCREWED|S\/E/.test(a))) { const r = one(c, new RegExp(`^GLOBE VALVE, FORGED, S/E, ${ibr === 'IBR' ? 'IBR' : 'NON-IBR'} ${nb} NB$`)); return r ? linkTo(r.item_name) : undefined; }
      if (forged && tableH(a)) return mkStd(`GLOBE VALVE, FORGED, F/E, IBR ${nb} NB T/H`, 'MOUNTING');
      if (tableH(a) && (cs || /\bC\.S\b/.test(m)) && !ci) { const r = one(c, new RegExp(`^GLOBE VALVE, CAST STEEL, F/E, IBR ${nb} NB[- ]T/H`)); return r ? linkTo(r.item_name) : undefined; }
      if (tableH(a) && (ci || sgiOnly)) { const r = one(c, new RegExp(`^GLOBE VALVE, ${sgiOnly ? 'SGI' : 'CI'}, F/E, IBR ${nb} NB,? T/H`)); return r ? linkTo(r.item_name) : undefined; }
      if (cs && /SCREWED|BSPT/.test(a)) return mkStd(`GLOBE VALVE, CAST STEEL, S/E, BSPT ${nb} NB`, 'MOUNTING');
      return;
    }
    if (/BALL VALVE/.test(d)) {
      const cls = /#\s*150|150 ?#|ANSI/.test(a);
      if (cls && ci) { const r = one(c, new RegExp(`^BALL VALVE, CI, F/E, CLASS150,3/P, NONIBR-${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
      if (cls && cs) { const r = one(c, new RegExp(`^BALL VALVE, CS, F/E, CL150, 3P, NONIBR-${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
      return;
    }
    if (/NRV|CHECK VALVE/.test(d)) {
      if (/DISK CHECK|DISC CHECK/.test(d)) { const r = one(c, new RegExp(`^DISK CHECK VALVE, SS 304, ${nb} MM, 150#`)); return r ? linkTo(r.item_name) : undefined; }
      if (/NRV/.test(d) && cs && (tableH(a) || /IBR/.test(a))) { const r = one(c, new RegExp(`^NRV, HORIZONTAL, CS, F/E, IBR ${nb} MM$`)); return r ? linkTo(r.item_name) : undefined; }
      if (/SWING CHECK/.test(d) && ci && /NIBR|NON/.test(a)) return mkStd(`NRV, SWING TYPE, CI, F/E, CLASS150, NON-IBR ${nb} MM`, 'MOUNTING');
      return;
    }
    if (/STRAINER/.test(d)) {
      if (ci && tableH(a) && !cs) { const r = one(c, new RegExp(`^Y STRAINER, CI, F/E, IBR ${nb} MM$`)); return r ? linkTo(r.item_name) : undefined; }
      if (ci && /ANSI|#\s*150/.test(a)) return mkStd(`Y STRAINER, CI, F/E, CL150, NIBR ${nb} MM`, 'MOUNTING');
      if (cs && tableH(a)) { const r = one(c, new RegExp(`^Y STRAINER, C\\.S, F/E, CL150, IBR ${nb} MM$`)); return r ? linkTo(r.item_name) : undefined; }
      return;
    }
    if (/MOISTURE SEP/.test(d)) return mkStd(`MOISTURE SEPARATOR, C.S, F/E, T/H IBR ${nb} MM`, 'MOUNTING');
    if (/\bPRV\b/.test(d)) return mkStd(`PRV, CS, F/E, CLASS-150, NON-IBR ${nb} MM`, 'MOUNTING');
  },
});

// Mobrey level-control assemblies (variants differ by centre-to-centre, body material, flange table)
RULES.push({
  name: 'mobrey',
  test: l => /^(MOBERY CONTROL VALVE|PISTON FOR MOBERY)/.test(U(l.desc)),
  do: (l, c) => {
    const a = all(l);
    const cc = a.match(/C\/C\s*(\d+)/)?.[1];
    const nb = sizeNb(l)[0];
    const mat = /\bCI\b|SGI|C\.I/.test(U(l.moc)) ? 'CI' : 'CS';
    const flg = /ANSI|#\s*150/.test(a) ? 'CLASS-150 NON-IBR' : 'IBR T/H';
    if (/PISTON/.test(U(l.desc))) return mkStd(`MOBREY CONTROL VALVE PISTON, ${mat}, F/E, ${flg}, ${nb} NB`, 'MOUNTING');
    return mkStd(`MOBREY CONTROL VALVE, ${mat}, F/E, ${flg}, ${nb} NB${cc ? `, C/C ${cc}` : ''}`, 'MOUNTING');
  },
});

// Steam traps / reflex level gauges / pressure gauges / thermometers
RULES.push({
  name: 'steam-trap',
  test: l => /STEAM TRAP/.test(U(l.desc)) && !/CONDENSATE RECOVERY/.test(U(l.desc)),
  do: (l, c) => {
    const nb = sizeNb(l)[0]; if (!nb) return;
    const r = one(c, new RegExp(`^STEAM TRAP THERMO DYNAMIC-TD-3 CS, IBR ${nb} MM`));
    return r ? linkTo(r.item_name) : undefined;
  },
});
RULES.push({
  name: 'level-gauge',
  test: l => /WATER LEVEL GAUGE|LEVEL INDICATOR/.test(U(l.desc)),
  do: (l, c) => {
    const a = all(l); const cc = a.match(/C\/C\s*-?\s*(\d+)/)?.[1];
    if (/LEVEL INDICATOR/.test(U(l.desc))) return mkStd(`LEVEL INDICATOR WITH TUBE, SS, F/E, 15 NB, C/C ${cc || ''}`.trim(), 'MOUNTING');
    if (/REFLEX|TUBULAR/.test(a) && cc) { const r = one(c, new RegExp(`^WATER LEVEL GAUGE REFLEX TYPE, F/E, IBR, CC ${cc} X 20MM$`)); return r ? linkTo(r.item_name) : undefined; }
  },
});
RULES.push({
  name: 'pressure-gauge',
  test: l => /PRESSURE GAUGE|PR\. GAUGE/.test(U(l.desc)),
  do: (l, c) => {
    const a = all(l).replace(/''/g, '"');
    const dial = a.match(/D-? ?(\d+)\s*"/)?.[1];
    const range = a.match(/0\s*-\s*([\d.]+)\s*(?:KG|K)/)?.[1];
    const conn = a.match(/(\d\/\d)"? ?BSP/)?.[1];
    if (!dial || !range) return;
    const ss = /^SS/.test(U(l.moc));
    const known = c.find(new RegExp(`^PRESSURE GAUGE${ss ? '[- ]SS-?' : ''} ?-?DIAL:${dial}" ; 0 T[0O] ${esc(range)} Kgs`));
    if (known.length === 1 && !ss && (!conn || known[0].item_name.includes(`${conn}" BSP`) || (dial === '4' && conn === '1/4'))) return linkTo(known[0].item_name);
    return mkStd(`PRESSURE GAUGE${ss ? ' SS' : ''} DIAL:${dial}" ; 0 TO ${range} Kgs${conn ? ` ; ${conn}" BSP` : ''}`, 'PRESSURE GAUGE');
  },
});
RULES.push({
  name: 'temperature',
  test: l => /THERMO ?COUPLE|TEMP\. GAUGE|THERMO METER|THERMOMETER/.test(U(l.desc)),
  do: (l, c) => {
    const a = all(l);
    if (/THERMO ?COUPLE PT ?100/.test(a)) { const r = one(c, /^THERMO COUPLE PT-100 \/ J \/ K X 6"/); return r ? linkTo(r.item_name) : undefined; }
    const range = a.match(/0\s*-\s*(\d+)\s*DEG/)?.[1];
    const dial = a.match(/(?:^|[\s-])(\d{1,2})"\s*-\s*0/)?.[1] || '4';
    const r = range && one(c, new RegExp(`^Thermometer[- ]Dial:${dial}" ?X ?\\d+" Steam 0-${range} Deg C`));
    return r ? linkTo(r.item_name) : undefined;
  },
});

// ---- chunk E: threaded / socket-weld fittings, bends, nipples, reducers, syphons ------------------------------------
RULES.push({
  name: 'pr-gauge-fittings',
  test: l => /FOR PR\.? ?(GAUGE|SWITCH)|FOR MOSITURE|FOR THERMOWELL/.test(U(l.desc)) && /COUPLING|HEX ?NIPPLE|COULING/.test(U(l.desc)),
  do: (l, c) => {
    const d = U(l.desc);
    if (/REDUCER HEX ?NIPPLE/.test(d)) return linkTo('IBR REDUCER HEXNIPPLE FOR Pr.Gauge');
    if (/REDUCER COUPLING/.test(d)) return linkTo('REDUCER COUPLING FOR Pr.Gauge');
    if (/HEX ?NIPPLE/.test(d)) return linkTo('HEXNIPPLE FOR Pr.Gauge');
    if (/IBR COUPLING/.test(d)) return linkTo('COUPLING (SOCKET WELD) IBR-CLASS#3000 15 MM (1/2")');
    if (/THERMOWELL/.test(d)) return linkTo('COUPLING, NON-IBR-SC-40 15 MM (1/2")');
    return create({ name: 'COUPLING FOR Pr.Gauge / Pr.Switch, SA 105, 1/2" CLASS#600', group: 'COUPLING', bom_category: 'standard', uom: 'Nos', mfg: 0 });
  },
});
RULES.push({
  name: 'fittings-by-nb',
  test: l => /COUPLING|COULING|NIPPLE|HEXNIPLLE|ELBOW|BENDS?\b|T ?- ?JOINT|T JOINT|\bTEE\b|REDUCER|EXPANDER|SYPHON|END CAP|CROSS HEADER/.test(U(l.desc)) && !/GASKET|FLANGE|FEEDER|VALVE|CLAMP/.test(U(l.desc)),
  do: (l, c) => {
    const d = U(l.desc), a = all(l), m = U(l.moc);
    const nbs = sizeNb(l); const nb = nbs[0];
    const bcl = /'?\s?B'?\s?CL(ASS)?|B "CLASS/.test(a);
    const socket = /\(ST\)|#\s*3000|3000 ?(LBS|#)/.test(a);
    if (/SYPHON|SIPHON/.test(d)) { const r = one(c, new RegExp(`^${/^U/.test(d) ? "U'" : "Q'"} TYPE SYPHON`)); return r ? linkTo(r.item_name) : undefined; }
    if (/REDUCER|EXPANDER/.test(d)) {
      const xs = a.match(/(\d+)\s*X\s*(\d+)\s*MM/);
      const tk = allThk(l.size);
      if (!xs && tk.length === 1 && /\dLG|LG X|X \d+ ?LG/.test(U(l.size))) { const r = one(c, new RegExp(`^MS PLATES ${esc(String(tk[0]))} MM$`)); if (r) return linkTo(r.item_name); }
      if (!xs) return /^REDUCER/.test(d) && !nbs.length ? { leave: 'reducer: no size stated in the line (only "STD" / "suitable to fan outlet") — needs Engineering to complete the line' } : undefined;
      const [s1, s2] = [Number(xs[1]), Number(xs[2])].sort((p, q) => p - q);
      const r = c.find(new RegExp(`^ECCENTRIC REDUCER, IBR-SC/40-${s1} MM X ${s2} MM`));
      return r.length === 1 ? linkTo(r[0].item_name) : create({ name: `ECCENTRIC REDUCER, IBR-SC/40-${s1} MM X ${s2} MM (${inch(s1) || ''})`, group: 'ECCNTRIC REDUCER', bom_category: 'pipe', uom: 'Nos', mfg: 0 });
    }
    if (!nb) return;
    if (/END CAP/.test(d)) return /or 80|OR 80/i.test(a) ? { leave: 'end cap: schedule given as "SCH-40 or 80" — needs Engineering to pick one' } : undefined;
    if (/CROSS HEADER/.test(d)) { const r = one(c, new RegExp(`^SEAMLESS PIPE SCH 40 IBR ${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
    if (/ELBOW|BENDS?\b/.test(d)) {
      if (/\bSS\b/.test(m)) return create({ name: `BEND ${/45/.test(a) ? '45' : '90'} DEG, SS, ${nb} NB (${inch(nb)}) HEAVY`, group: 'BENDS', bom_category: 'standard', uom: 'Nos', mfg: 0 });
      if (bcl) return create({ name: `BENDS, MS B CLASS, ${/LR|LONG/.test(a) ? 'LONG RADIUS ' : ''}${/45/.test(a) ? '45' : '90'} DEG, ${nb} MM (${inch(nb)})`, group: 'BENDS', bom_category: 'standard', uom: 'Nos', mfg: 0 });
      if (/SCH[- ]?40|SMLS|SA ?106/.test(a)) {
        const kind = /LONG/.test(a) ? 'LONG, IBR-SC/40-' + nb + ' MM' : /45/.test(a) ? `SHORT\\(45\\)IBR[- ]SC/40 ?${nb} ?MM` : `SHORT\\(90\\)IBR[- ]SC/40 ?${nb}MM`;
        const r = c.find(new RegExp(`^BENDS, SEAMLESS, ${/LONG/.test(a) ? esc(kind) : kind}`));
        return r.length === 1 ? linkTo(r[0].item_name) : undefined;
      }
      return;
    }
    if (/NIPPLE/.test(d) && !/HEX/.test(d)) {
      const len = a.match(/(\d+(?: \d\/\d)?)\s*"\s*LG/i);
      const lenIn = len ? len[1].trim().split(' ').reduce((t, x) => t + (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x)), 0) : null;
      const lenMm = lenIn ? Math.round(lenIn * 25.4 / 5) * 5 : null;
      if (/SMLS|SCH[- ]?40/.test(a) && lenMm === 150) { const r = one(c, new RegExp(`^PIPE NIPPLE, IBR-SC[-/]40[- ]${nb} MM X 150 MM`)); return r ? linkTo(r.item_name) : undefined; }
      if (/SMLS|SCH[- ]?40/.test(a) && lenMm) return create({ name: `${/^T'/.test(d) ? 'T NIPPLE THREADED' : 'PIPE NIPPLE'}, IBR-SC/40-${nb} MM X ${lenMm} MM (${inch(nb)})`, group: 'PIPE NIPPLE', bom_category: 'pipe', uom: 'Nos', mfg: 0 });
      const r = one(c, new RegExp(`^PIPE NIPPLE, NON-IBR-SC[-/]40[- ]?${nb} MM`));
      return r ? linkTo(r.item_name) : undefined;
    }
    if (/HEX ?NIPP?L+E/.test(d)) {
      if (!socket) { const r = one(c, new RegExp(`^HEX NIPPLE MS NON-IBR ${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
      if (socket) return create({ name: `HEX NIPPLE (SOCKET WELD) IBR-CLASS#3000 ${nb} MM (${inch(nb)})`, group: 'HEX NIPPLE', bom_category: 'standard', uom: 'Nos', mfg: 0 });
      return;
    }
    if (/\bTEE\b|T ?- ?JOINT|T JOINT/.test(d)) {
      if (socket) return create({ name: `TEE (SOCKET WELD) IBR-CLASS#3000 ${nb} MM (${inch(nb)})`, group: 'COUPLING', bom_category: 'standard', uom: 'Nos', mfg: 0 });
      return create({ name: `TEE, MS${bcl ? ' B CLASS' : ''}, THREADED ${nb} MM (${inch(nb)})`, group: 'COUPLING', bom_category: 'standard', uom: 'Nos', mfg: 0 });
    }
    if (/COUPLING|COULING/.test(d)) {
      if (socket) { const r = one(c, new RegExp(`^COUPLING \\(SOCKET WELD\\) IBR-CLASS#3000[- ]${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
      if (/SA ?106|SCH[- ]?40/.test(a)) { const r = one(c, new RegExp(`^COUPLING, IBR-SC[-/]40[- ]${nb} MM`)); return r ? linkTo(r.item_name) : undefined; }
      const r = one(c, new RegExp(`^COUPLING, NON-IBR-SC[-/]40[- ]${nb} MM`));
      return r ? linkTo(r.item_name) : undefined;
    }
  },
});

// ---- chunk F: electrical -------------------------------------------------------------------------------------------
const mk = (name, group, extra = {}) => create({ name, group, bom_category: 'other', uom: 'Nos', mfg: 0, ...extra });
const nm = (c, n) => c.byName(n) ? linkTo(n) : undefined;
RULES.push({
  name: 'electrical',
  test: l => /\bMCB\b|MCCB|CONTACTOR|OVER ?LOAD RELAY|ADD ON|TIMER|BUZZER|EMERGENCY STOP|PUSH BUTTON|SELECTOR SWITCH|ELEMENTS SG|FERRULES|LUGS|FLEXIBLE COPPER|EARTH WIRE|> COPPER|SQ MM \d+ CORE|CABLE GLAND|VFD CONTROL|CONTROL PANEL|ELECTRICAL PANEL|MOTOR( RATING)?$|^MOTOR\b/.test(U(l.desc)),
  do: (l, c) => {
    const d = U(l.desc).replace(/^L ?& ?T /, '');
    if (/VFD CONTROL PANEL/.test(d)) { const hp = d.match(/^(\d+(?:\.\d+)?) ?HP/)?.[1]; return hp ? nm(c, `VARIABLE SPEED DRIVE (VFD) ${hp} Hp`) : undefined; }
    if (/^MCCB/.test(d)) { const a = d.match(/(\d+) AMPS/)?.[1]; return a === '100' ? linkTo('MCCB DH / DU 100 AMPS') : undefined; }
    let m;
    if ((m = d.match(/^MCB (\d+) AMPS (\d) POLE/))) {
      const [, a, p] = m;
      const known = { '3-10': 'MCB NB1-63H 3P C10 10kA DB // MCB 10 AMPS ; 3 P', '3-20': 'MCB NB1-63H 3P C20 10kA DB // MCB 20 AMPS 3 P', '3-25': 'MCB 25 AMPS 3P', '3-32': 'MCB 32 AMPS 3 P', '3-40': 'MCB NB1-63H 3P C32/C40 10kA // MB 3P 40 AMPS C CURVE', '3-63': 'MCB NB1-63H 3P C63 10kA DB // 63 AMPS 3P', '3-80': 'MCB NB1-63H 3P C80 10kA DB // MCB 80 AMPS 3P' }[`${p}-${a}`];
      return known ? linkTo(known) : mk(`MCB ${a} AMPS ${p}P`, 'MCB');
    }
    if ((m = d.match(/^POWER CONTACTOR 3 POLE MNX (\d+) AMPS/))) return nm(c, `CONTACTOR AMPS > ${m[1]}`);
    if (/AUXILIARY CONTACTOR/.test(d)) return linkTo('AUX. CONTACTOR 22E/ MX 0 / CONTROL CONTR');
    if ((m = d.match(/^OVER ?LOAD RELAY MN2 ([\d.]+)-([\d.]+) AMPS/))) {
      const t = { '3-5': 2383, '14-23': 2396, '4.5-7.5': 2384, '6-10': 2385 }[`${m[1]}-${m[2]}`];
      const row = t && c.find(new RegExp('.')).find(r => r.id === t);
      return row ? linkTo(row.item_name) : mk(`OVER LOAD RELAY MN2 ${m[1]}-${m[2]} AMPS`, 'RELAY OLR');
    }
    if ((m = d.match(/^MNX ADD ON BLACK (\d) NO \+ (\d) NC/))) return mk(`MNX ADD ON AUXILIARY CONTACT BLOCK ${m[1]} NO + ${m[2]} NC`, 'CONTACTOR');
    if (/^EAPL TIMER/.test(d)) return mk('TIMER EAPL A1D1 240 VAC', 'ELECTRICAL');
    if (/^BUZZER/.test(d)) return linkTo('BUZZER 3 TONE 220 VOLTS SIZE 96/96');
    if (/^EMERGENCY STOP/.test(d)) return mk('EMERGENCY STOP PUSH BUTTON', 'PUSH BUTTON');
    if ((m = d.match(/^PUSH BUTTON 22\.5MM (\w+)/))) return mk(`PUSH BUTTON 22.5 MM ${m[1]}`, 'PUSH BUTTON');
    if ((m = d.match(/^SELECTOR SWITCH (\d) POSITION/))) return mk(`SELECTOR SWITCH ${m[1]} POSITION`, 'SWITCH');
    if (/^ELEMENTS SG GREEN \(NO\)/.test(d)) return linkTo('CONTACT ELEMENTS NO');
    if (/^ELEMENTS SG RED \(NC\)/.test(d)) return linkTo('CONTACT ELEMENTS NC');
    if ((m = d.match(/^FERRULES ([\d.]+) SQ MM ([A-Z0-9-]+) BIG T TYPE/))) return mk(`FERRULES ${m[1]} SQ MM ${m[2]} BIG T TYPE`, 'ELECTRICAL');
    if ((m = d.match(/^INSULATED LUGS ([\d.]+) SQ MM FORK TYPE/))) return nm(c, m[1] === '1.5' ? 'LUGS FORK TYPE-1.5 SQMM' : `LUGS FORK TYPE ${m[1]} SQMM`);
    if (/^LUGS$/.test(d) && /STD/.test(U(l.size))) return { leave: 'lugs "STD": no size / type given — needs Engineering to complete the line' };
    if ((m = d.match(/^FLEXIBLE COPPER WIRE BLACK (\d+) SQ MM/))) return m[1] === '1' ? linkTo('CABLE 1 SQ MM BC 1100 V') : m[1] === '4' ? linkTo('CABLE 4 SQ MM X BC 11OO V') : mk(`CABLE ${m[1]} SQ MM BC 1100 V`, 'CABLE', { bom_category: 'standard', uom: 'Mtr' });
    if ((m = d.match(/^EARTH WIRE GREEN (\d+) SQ MM/))) return mk(`EARTH WIRE GREEN ${m[1]} SQ MM`, 'CABLE', { bom_category: 'standard', uom: 'Mtr' });
    if ((m = d.match(/>\s*COPPER\s*(?:(DELTA|S\/D|FL)\s+)?([\d.]+) SQ MM X (\d) CR\s*\(([^)]*)\)/i)) || (m = d.match(/^COPPER ([\d.]+) SQ MM X (\d) CR/) && null)) {
      const [, tag, sq, cores, extra] = m;
      return mk(`CABLE COPPER ${sq} SQ MM X ${cores} CORE ${/ARMOURED/.test(extra) ? 'ARMOURED' : ''}${/SHIELD/.test(extra) ? ' & SHIELDED' : ''}`.replace(/\s+/g, ' ').trim(), 'CABLE', { bom_category: 'standard', uom: 'Mtr' });
    }
    if ((m = d.match(/^COPPER ([\d.]+) SQ MM X (\d) CR \(([^)]*)\)/))) return mk(`CABLE COPPER ${m[1]} SQ MM X ${m[2]} CORE ${/ARMOURED/.test(m[3]) ? 'ARMOURED' : ''}${/SHIELD/.test(m[3]) ? ' & SHIELDED' : ''}`.replace(/\s+/g, ' ').trim(), 'CABLE', { bom_category: 'standard', uom: 'Mtr' });
    if ((m = d.match(/^([\d.]+) SQ MM (\d+) CORE$/))) return mk(`CABLE ${m[1]} SQ MM X ${m[2]} CORE`, 'CABLE', { bom_category: 'standard', uom: 'Mtr' });
    if (/^CABLE GLAND/.test(d)) return { leave: 'cable glands "as per cable size and motor gland PG": sizes not stated — needs Engineering to complete the line' };
    if (/^CONTROL PANEL/.test(d)) return mk('CONTROL PANEL (AS PER ENCLOSED LIST)', 'ELECTRICAL', { bom_category: 'standard' });
    if (/^ELECTRICAL PANEL BOARD/.test(d)) return mk('ELECTRICAL PANEL BOARD WITH WIRING DIAGRAM', 'ELECTRICAL', { bom_category: 'standard' });
    if (/^MOTOR/.test(d)) {
      const a = `${l.desc} ${l.size}`.toUpperCase();
      const hp = a.match(/(\d+(?:\.\d+)?)\s*HP/)?.[1];
      if (!hp) return { leave: 'motor rating: no HP stated (only efficiency class) — needs Engineering to complete the line' };
      return mk(`MOTOR ${hp} HP${/IE2/.test(`${l.moc} ${l.size}`.toUpperCase()) ? ' IE2' : ''}`, 'MOTOR');
    }
  },
});

// ---- chunk G: consumables, mechanical and one-off parts (explicit decisions, each checked against the catalog) --------
const fullText = l => U(`${l.desc} | ${l.moc} | ${l.size}`);
const std = (name, group, extra = {}) => create({ name, group, bom_category: 'standard', uom: 'Nos', mfg: 0, ...extra });
const oth = (name, group, extra = {}) => create({ name, group, bom_category: 'other', uom: 'Nos', mfg: 0, ...extra });
const INSUFF = why => ({ leave: why });
const MISC = [
  // --- lines whose size / thickness / quantity cell is missing or shifted: the source cannot identify one item ---
  [/^(BODY SHELL MATERIAL|BOLT & NUTS|MS ANGLE|MS CHANNEL|MS FLAT|KEY WAY ROD|PULLEY|PLATE WASHERS|SHAFT|SLEEVE \(CHECK NUT\)|PLUMMBER BLOCKS|V' BELT|BEARINGS) \| (\d[\d.]* ?(NOS?|MTRS?|SET)\b|1\.5 NO|80 NO)/i, () => INSUFF('size/quantity columns are shifted (a quantity sits where the material or size should be) — the line does not say which size to buy; needs Engineering to correct the row')],
  [/^(BODY SHELL MATERIAL|PLATE WASHERS) \| (1 NO|1\.5 NO|4 NOS)/i, () => INSUFF('size/quantity columns are shifted — needs Engineering to correct the row')],
  [/^APH TO MDC \| MS \|\s*$/, () => INSUFF('duct piece with no size or thickness stated')],
  [/^C CHANNEL \| +\| *$/, () => INSUFF('channel with no section size stated')],
  [/^LIFTING HOOKS \| [^|]+\| STD$/, () => INSUFF('lifting hooks "STD": no size stated')],
  [/^(MS STRUCTURE SUPPORT|DIST\. PIPE FIX ANGLE|STRUCTURE WITH BASE PLATE) \|[^|]*\| (ISA ?\d+ ?X? ?\d*|ISA\d+ - 1600 LG\.?)$/i, () => INSUFF('angle section without thickness (e.g. ISA 50x50) — thickness not stated')],
  [/^RECTANGLE \| MS \| 25 X 40$/, () => INSUFF('rectangular section 25 x 40 with no thickness / length stated')],
  [/^SS CONE \|/, () => INSUFF('"as per drawing" — no dimensions in the line')],
  [/^REDUCER \| SA 105 \| Φ70/i, () => std('REDUCER SA 105 DIA 70 X 75 LG', 'REDUCER')],
  [/^(REDUCER|VENTURY) \|[^|]*\| (RIVET WITH CAGES|STD)?$/i, () => INSUFF('no size stated in the line')],
  [/^CAN VAS CLOST|^CANVASH CLOTH/, () => INSUFF('canvas cloth: no size stated ("suitable to fan outlet" / blank)')],
  [/^CASTABLE REFRACTORY \|/, () => INSUFF('castable refractory: grade / bag size not stated (only a volume)')],
  [/^FIRECLAY \|/, () => INSUFF('description says fire clay but the size cell names INSULYTE-7 — the two are different products; needs Engineering to correct the row')],
  [/^FIRE DOOR \(BIG\) \| CI \| STD$/, () => INSUFF('big fire door "STD": frame size not stated')],
  [/^(SHAFT|STAY BARS|PLATE SIZE :|BQ PLATE MATERIAL|MS SQUARE ROD \(MH|PIN \|)/i, l => { const z = U(l.size); const many = (z.match(/(LG|LONG)\b/gi) || []).length >= 2 || (z.match(/[ΦØ∅]|\bDIA\b/gi) || []).length >= 2 || (z.match(/\d+ ?X ?\d+ ?X ?\d+/g) || []).length >= 2 || (z.match(/\d+X\d+-\d+LG/gi) || []).length >= 2 || /\d+(LG| LG) ?\/ ?\d/i.test(z); return many ? INSUFF('bundled: one line lists several different sizes of the same part — needs a human split') : undefined; }],
  [/^CHIMNEY \| MILD STEEL \| DIA ?: ?300NB X 5\.2MM PIPE/, () => std('MS PIPE IS 3589 300 NB X 5.2 MM THK', 'MS PIPE', { bom_category: 'pipe' })],
  [/^CHIMNEY \| MILD STEEL \| TOP DIA/, () => INSUFF('bundled: one line lists a tapered piece and two straight pieces of different thickness — needs a human split')],
  [/^TURN BUCKLES/, () => INSUFF('bundled: turn buckles and D clamps in one line — needs a human split')],
  [/^(11 PIN PLA RELAY)/, () => linkTo('RELAY WITH BASE 11 PIN')],
  [/^BOILER INSULATION GLASS WOOL|^INSULATION GLASS WOOL|^INSULATION \d+ MM THICK FOR BOILER/, l => { const m = fullText(l).match(/(\d+) ?MM THK @ (\d+) DEN/); return m ? oth(`INSULATION GLASS WOOL ${m[1]} MM THK, ${m[2]} DENSITY`, 'INSULATION', { uom: 'Mtr' }) : undefined; }],
  [/^(ACOSET|ACO SET|ACCOSET) 50/, () => linkTo('ACOSET 50 KGS BAG')],
  [/^INSULYTE-7/, l => linkTo('CASTABLE INSULITE 25 KGS BAG')],
  [/^END ARCH BRICKS/, () => linkTo('END ARCH BRICKS 75 X 65')],
  [/^REFRACTORY TILES/, () => std('REFRACTORY TILES IS8 230 X 115 X 25', 'REFRACTORY')],
  [/^FIRE BRICKS IN FURNACE/, () => linkTo('FIRE BRICKS STANDARD IS8 230 X 115 X 75')],
  [/^ASBESTOR ROPE \| ASBESTOR \| 16 MM/, () => linkTo('ASBESTOS METALLIC ROPE 16 MM')],
  [/^ASBESTOR ROPE \+ HOLDTITE/, l => std(`ASBESTOS ROPE WITH HOLDTITE ${fullText(l).match(/DIA (\d+)/)?.[1]} MM`, 'PACKINGS')],
  [/^INSULATION TAPE/, () => linkTo('INSULATION TAPE')],
  [/^TINNER/, () => linkTo('THINNER ORDINERY')],
  [/^PAINTS \| +\| (BLACK|FERRUS BLUE|REDOXIDE|TERPENTOIL|TINNER)$/, l => ({ BLACK: linkTo('PAINT ENAMAL BLACK'), 'FERRUS BLUE': oth('PAINT FERRUS BLUE', 'PAINTS', { uom: 'Ltr' }), REDOXIDE: linkTo('PRIMER REDOXIDE'), TERPENTOIL: linkTo('TERPANTILE OIL'), TINNER: linkTo('THINNER ORDINERY') })[U(l.size)]],
  [/^PAINTS \| +\| FERRUS BLUE BLACK/, () => INSUFF('bundled: one line lists five different paints/thinners — needs a human split')],
  [/^(HAND )?WHEEL \| CI \| (\d+)"/, l => linkTo(`CI WHEELS ${U(l.size).match(/(\d+)"/)[1]}"`)],
  [/^PLATE WASHERS \| +\| (1\/2|3\/8)"/, l => linkTo(U(l.size).includes('1/2') ? 'MS WASHERS 1/2"' : 'MS MS WASHERS 3/8"')],
  [/^PLUM+(B)?ER BLOCKS \| C\.I \| SN-(\d+)/, l => linkTo(`PEDESTRIAL SN-${fullText(l).match(/SN-(\d+)/)[1]}`)],
  [/^PULLEY \| C\.I \| B(\d) - (\d+)"/, l => { const m = fullText(l).match(/B(\d) - (\d+)"/); return linkTo(`PULLEY CI ${m[2]}" X ${m[1]}G X TYPE B`); }],
  [/^V' BELT \| - \| B-(\d+)/, l => linkTo(`V BELTS B GROOVE ${fullText(l).match(/B-(\d+)/)[1]} INCH`)],
  [/^BEARINGS \| SS \| 2209K/, () => linkTo('BALL BEARINGS 2209-K')],
  [/^RAV \| CI \| 8/, () => linkTo('RAV 200 MM (8") WITHOUT GEARED MOTOR')],
  [/^VENTUR[YI] \| CI \| 4"/, () => linkTo('VENTURI, CI 4"')],
  [/^VENTURI \| CS \| 5"/, () => std('VENTURI, CS 5"', 'VENTURI')],
  [/^VIEW GLASS \| TOUGHEND \| 4"/, () => linkTo('VIEW GLASS TOUGHENED 4" 100 MM OD')],
  [/^SG TOUGHENED GLASS/, () => std('ROUND TOUGHENED GLASS 100 MM X 10 THK', 'GLASS')],
  [/^SG (BOLT|TOP) FLANGE/, () => linkTo('MS PLATES 16 MM')],
  [/^SG BOLTS/, () => std('BOLTS M12 X 60 MM', 'FASTENERS')],
  [/^SG GASKET/, () => std('SIGHT GLASS GASKET, METALIC, 3 MM THK', 'PACKINGS')],
  [/^SG NECK PIPE/, () => std('SS PIPE 304 SCH-20 80 NB (3")', 'SS PIPE', { bom_category: 'pipe' })],
  [/^SLEEVE \(CHECK NUT\) \| - \| H309/, () => linkTo('SLEEVES H-309')],
  [/^TRIPLEX FIRE BAR/, () => linkTo('GRATE BARS, CI, TRIPLEX 630 MM T3')],
  [/^H' BAR \| CI \| 40HT\. X (\d+)W X (\d+) LG/, l => { const m = fullText(l).match(/40HT\. X (\d+)W X (\d+) LG/); return oth(`H BAR, CI, 40 HT X ${m[1]} W X ${m[2]} LG`, 'FIRE BARS'); }],
  [/^MS GRILL/, l => { const m = fullText(l).match(/W:(\d+) ?X? ?L:(\d+)/); return m ? oth(`MS GRILL HT 35 X W ${m[1]} X L ${m[2]}`, 'GRILL', { moc: 'MS' }) : undefined; }],
  [/^HYLAM (N|B)USH/, l => { const m = fullText(l).match(/OD (\d+) X ID ([\d.]+) ?[X-] ?(\d+) LG/); return m ? oth(`HYLAM BUSH OD ${m[1]} X ID ${m[2]} X ${m[3]} LG`, 'BUSH') : undefined; }],
  [/^PIN BUSH \| MS \| DIA (\d+) X (\d+) LG\.?$/, l => { const m = fullText(l).match(/DIA (\d+) X (\d+)/); return oth(`PIN BUSH MS DIA ${m[1]} X ${m[2]} LG`, 'BUSH', { moc: 'MS' }); }],
  [/^PIN BUSH \| MS \| DIA 50 X 100/, () => INSUFF('bundled: one line lists two pin bush sizes — needs a human split')],
  [/^PIN \| EN8 \/ MS \| DIA 16/, () => linkTo('MS ROD 16 MM (1 MTR 1.60 KGS)')],
  [/^PIN \| +\| DIA 60/, () => INSUFF('stepped pin with two diameters (60 / 25) — raw bar size not stated')],
  [/^LADDER STEP/, () => linkTo('MS ROD 16 MM (1 MTR 1.60 KGS)')],
  [/^REFRACTORY ANCHOR RODS/, () => linkTo('MS ROD 6 MM (1 MTR 0.22 KGS)')],
  [/^WOODEN HANDLE/, () => oth('WOODEN HANDLE 25 MM X 120 HT', 'TOOLS')],
  [/^SCREW FEEDER/, () => oth('SCREW FEEDER MS 6" X 1200 LG', 'MISSLANIOUS')],
  [/^SELF SCREWS/, () => std('SELF SCREWS GI M8 X 25 LG', 'FASTENERS')],
  [/^(MS )?BOLT WITH NUTS \(HIGH TENSILE\)|^MS BOLT WITH NUTS \(HIGH TENSILE\)/, () => std('HIGH TENSILE BOLTS & NUTS 3/4" X 3"', 'FASTENERS')],
  [/^CHIMNEY FOUNDATION \(DOUBLE NUT/, () => linkTo('FOUNDATION BOLTS & MS NUTS 25 MM X 1.2/1.5 L')],
  [/^FOUNDATION BOLT & NUT WITH WASHERS/, () => linkTo('BOLTS 1/2" X 1 1/2"')],
  [/^I-BOLT/, l => { const t = fullText(l); const m = t.match(/(5\/8)" X (\d)/); const kind = /HAND WEEL/.test(t) ? 'WITH HAND WHEEL' : /WING/.test(t) ? 'WITH WING NUTS' : 'WITH CLEAT'; return std(`I-BOLT ${kind}, ${/\bSS\b/.test(U(l.moc)) ? 'SS' : 'MS'}, ${m[1]}" X ${m[2]}"`, 'FASTENERS'); }],
  [/^INSULATORS WITH BOLTS/, () => linkTo('CERAMIC INSULATOR BOLTS')],
  [/^MDC CONES/, () => linkTo('CI CONES SIZE:OD 290 MM X HEIGHT 897 MM WITH VANES')],
  [/^(METALIC|METALLIC) GASKETS \| METALIC \| OD (108|165\.1|203) /, l => linkTo({ '108': 'ASBESTOS CUT GASKET METALIC 25 MM / 1"', '165.1': 'ASBESTOS CUT GASKET-METALIC 50 MM / 2"', '203': 'ASBESTOS CUT GASKET-METALIC 80 MM / 3"' }[fullText(l).match(/OD (108|165\.1|203)/)[1]])],
  [/^U-TYPE RUBBER GASKET/, () => std('U-TYPE RUBBER GASKET, SILICON RUBBER (200 DEG C), GROOVE 5 MM X DEEP 30 MM', 'PACKINGS')],
  [/^RUBBER HOSE PIPE/, () => oth('RUBBER HOSE PIPE 40 MM WITH C CLAMP', 'MISSLANIOUS')],
  [/^CLEANING BRUSH/, () => oth('CLEANING BRUSH FOR BOILER TUBES', 'TOOLS')],
  [/^CAGE MATERIAL/, () => oth('FILTER CAGE MATERIAL, MS, DIA 143 X 3480 LG', 'MISSLANIOUS')],
  [/^CAGE WITH VERTICAL WIRE/, () => oth('FILTER CAGE WITH VERTICAL WIRE, 20 & 3 MM WIRE DIA', 'MISSLANIOUS')],
  [/^FILTER MATERIAL/, () => oth('FILTER BAG FABRIC, 100% WOVEN GLASS WITH PTFE MEMBRANE LAMINATION', 'MISSLANIOUS')],
  [/^CANVAS (CLOTH|CLOT)/, l => { const m = fullText(l).match(/I\/S (\d+) X I\/S (\d+)[ -]+X? ?(\d+) ?LG/); return m ? oth(`CANVAS CLOTH EXPANSION JOINT (RECTANGLE) I/S ${m[1]} X ${m[2]} X ${m[3]} LG`, 'MISSLANIOUS') : undefined; }],
  [/^CABLE TRAYS/, l => { const m = fullText(l).match(/(\d+)X(\d+) ?X ?(?:([\d.]+)T ?X ?)?2\.5 MTR/); return m ? oth(`CABLE TRAY ${m[1]} X ${m[2]} MM${m[3] ? ` X ${m[3]} THK` : ''} X 2.5 MTR`, 'ELECTRICAL') : undefined; }],
  [/^CABLE TIES/, () => undefined],
  [/^COPPER ([\d.]+) SQ MM X (\d) CR/, l => { const m = fullText(l).match(/COPPER ([\d.]+) SQ MM X (\d) CR \(([^)]*)\)/); return m ? oth(`CABLE COPPER ${m[1]} SQ MM X ${m[2]} CORE ARMOURED${/SHIELD/.test(m[3]) ? ' & SHIELDED' : ''}`, 'CABLE', { bom_category: 'standard', uom: 'Mtr' }) : undefined; }],
  [/^COUPLE FOR LEVEL SENSOR/, () => std('COUPLING FOR LEVEL SENSOR 40 NB BSP', 'COUPLING')],
  [/^PROBE TYPE ASH LEVEL SENSOR/, () => oth('PROBE TYPE ASH LEVEL SENSOR', 'ELECTRICAL')],
  [/^(HOPPER LEVEL SWITCH|ZERO SPEED SWITCH)/, () => oth('ZERO SPEED SWITCH', 'ELECTRICAL')],
  [/^ZERO LIMIT SWITCH FOR RAV/, () => oth('ZERO LIMIT SWITCH FOR RAV', 'ELECTRICAL')],
  [/^UT-6 PRESSURE SWITCH/, () => oth('PRESSURE SWITCH UT-6', 'PRESSURE SWITCH')],
  [/^DP SWITCH/, l => oth(`DP SWITCH 0-2 KG/SQCM${/500/.test(l.size) ? ', RANGE 0-500 MM SWC' : ''}`, 'PRESSURE SWITCH')],
  [/^FILTER REGULATOR FOR AIR/, () => oth('FILTER REGULATOR FOR AIR 1/2" BSP', 'MISSLANIOUS')],
  [/^MANOMETER \| STD/, () => oth('MANOMETER 0-1000 MM WC', 'PRESSURE GAUGE')],
  [/^MAGNETIC VIBRATING FEEDER/, () => oth('MAGNETIC VIBRATING FEEDER WITH DIGITAL UNIT 380 V', 'MISSLANIOUS')],
  [/^NEEDLE VALVE/, () => std('NEEDLE VALVE, S/E, 1/2" BSP (15 NB)', 'MOUNTING')],
  [/^SOLENOID VALVE/, () => std('SOLENOID VALVE, S/E, DIAPHRAGM TYPE, CAST ALUMINIUM, 40 MM', 'MOUNTING')],
  [/^GLOBE VALVE WITH GATE VALVE/, () => std('GLOBE VALVE WITH GATE VALVE, CI, F/E, IBR 25 NB T/H', 'MOUNTING')],
  [/^AIR HEADER FLANGE/, () => std('FLANGES, MS, T/F, NON-IBR-40 MM (11/2")', 'FLANGES')],
  [/^AIR NOZZLES? \| SS( 410)? \|/, l => std(`AIR NOZZLE SS${/410/.test(U(l.moc)) ? ' 410' : ''}, ${fullText(l).match(/([\d.]+) MM HOLE - (\d+) HOLES/)?.slice(1, 3).join(' MM HOLE, ')} HOLES${/2 INCH/.test(U(l.size)) ? ', 2" NOZZLE X 65 HT' : ', 150 MM DIA X 55 HT'}`, 'AIR NOZZLE')],
  [/^(FEED PUMP \(TYPE-CENTRIFUGAL\) & MOTOR)/, l => { const t = fullText(l); const f = t.match(/([\d.]+) M3\/HR/)?.[1], h = t.match(/(\d+) ?M+WC/)?.[1], hp = t.match(/([\d.]+) ?HP/)?.[1]; return f && h && hp ? std(`FEED PUMP CENTRIFUGAL${/SS 304/.test(U(l.moc)) ? ' SS 304' : ''} ${Number(f)} M3/HR, ${h} MWC, ${hp} HP${/IE2/.test(U(l.moc)) ? ' IE2' : ''}`, 'PUMP') : undefined; }],
  [/^SUPPPLY OF CONDENSATE RECOVERY PUMP|^SUPPLY OF STEAM OPERATED CONDENSATE RECOVERY/, () => linkTo('SAVOMAX CR PUMP + FLASH STEAM VESSEL 50MM FLOW:2100')],
  [/^SUPPPLY OF SS DEARATOR HEAD/, () => std('SS DEAERATOR HEAD FOR OH TANK, TANK DIA 1500', 'MISSLANIOUS')],
  [/^FIRE DOOR/, l => { const t = fullText(l); if (/BIG/.test(t) && /740/.test(t)) return std('FIRE DOOR (BIG) CI, FRAME 740 X 640', 'DOOR'); const m = t.match(/FRAME ?: ?(\d+)X(\d+)/); return m ? std(`FIRE DOOR CI, FRAME ${m[1]} X ${m[2]} (OPEN 321/343)`, 'DOOR') : undefined; }],
  [/^ACCESS DOOR OPENING/, () => std('TUBE SA 210 GR A1, 63.5 OD X 5.6 THK', 'ERW TUBES', { bom_category: 'pipe' })],
  [/^STUB \| BS 3059/, () => std('ERW TUBE BS 3059 PT.1, 73 OD X 5.16 THK', 'ERW TUBES', { bom_category: 'pipe' })],
  [/^(ALUMINIUM CLADDING|CLADDING ALUMINIUM|ALUMINIUM \| ALUMINIUM|GI COLOR COATED)/, l => { const g = fullText(l).match(/(\d+) GAUGE/)?.[1]; return g ? (c => c.byName(`ALUMINIUM SHEET ${g} GAUGE`) ? linkTo(`ALUMINIUM SHEET ${g} GAUGE`) : undefined) : undefined; }],
  [/^MS CHEQUERED SHEET \| MS \| 5 X 600/, () => linkTo('MS CHQEURED PLATES 5 MM')],
  [/^MS CORRUGATE SHEET/, () => oth('MS CORRUGATED SHEET 5 MM THK', 'MS PLATES', { uom: 'Kgs' })],
  [/^MS COUPLING \| MS \| 3\/8"/, () => std('COUPLING, NON-IBR, MS, 3/8" BSP', 'COUPLING')],
  [/^(NOZZLE BED PLATE|PLATE) \| MS \| (\d+) ?X ?\d+ ?X ?\d+/, l => linkTo(`MS PLATES ${fullText(l).match(/\| (\d+) ?X/)[1]} MM`)],
  [/^TUBE SHEET MATERIAL \| MS \| 1250X1500X10/, () => linkTo('MS PLATES 10 MM')],
  [/^MS ANGLE \| MS \| ISA40X5T/, () => linkTo('MS ANGLE 40 X 40 X 5 MM')],
  [/^MS STRUCTURE (FRAME|SUPPORT|WORK) \|[^|]*\| ISA ?50 ?X ?50 ?X ?5 ?(THK|T)/i, () => linkTo('MS ANGLE 50 X 50 X 5 MM')],
  [/^MS STRUCTURE (SUPPORT|WORK) \|[^|]*\| ISMC ?100 ?X ?50 ?(-\d+ ?LG )?ISA ?50 ?X ?50/i, () => INSUFF('bundled: one line lists a channel and an angle section — needs a human split')],
  [/^(FUEL FEEDER PIPE BEND)/, () => std('BEND 45 DEG, SS, 125 NB (5") HEAVY', 'BENDS')],
  [/^CROSS HEADER/, () => undefined],
  [/^HEX ?NIPPLE|^HEXNIPLLE/, () => undefined],
  [/^(THERMO COUPLING)/, () => undefined],
];
RULES.push({
  name: 'misc-table',
  test: () => true,
  do: (l, c) => {
    const t = fullText(l).replace(/ \| /g, ' | ');
    for (const [re, fn] of MISC) {
      if (!re.test(t)) continue;
      let out = fn(l, c);
      if (typeof out === 'function') out = out(c);
      if (out) return out;
    }
  },
});
