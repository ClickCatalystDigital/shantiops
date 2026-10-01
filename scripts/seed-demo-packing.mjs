// Realistic demo project for the combined packing list, modelled on the client's DISPATCH ON sheet.
// Tag: project_no 'ZZ-DEMO-PACK'. Creates the project through the real API (milestones, scope of supply),
// then writes the BOM tree, bought-out and fabricated lines, receipts with serials and routing straight
// to the database, so the packing list can be generated, edited and printed.
//   node --env-file=.env.local scripts/seed-demo-packing.mjs            (needs the dev server up)
//   node --env-file=.env.local scripts/seed-demo-packing.mjs --cleanup  (removes it through the real API)
import { createClient } from '@libsql/client';

const BASE = process.env.DEMO_BASE || 'http://localhost:3061';
const TAG = 'ZZ-DEMO-PACK';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
const run = (sql, args = []) => db.execute({ sql, args });

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
await api('POST', '/api/login', { username: 'admin', password: 'admin123' });

const existing = await run('SELECT id FROM projects WHERE project_no = ?', [TAG]);
if (existing.rows.length) {
  await api('DELETE', `/api/projects/${existing.rows[0].id}`, { confirmOverride: true });
  console.log('removed previous', TAG);
}
if (process.argv.includes('--cleanup')) { console.log('cleaned'); process.exit(0); }

const customer = await run("SELECT id, name FROM customers WHERE name LIKE 'HKM%' LIMIT 1");
const { id } = await api('POST', '/api/projects', {
  project_no: TAG, customer_name: customer.rows[0]?.name || 'HKM CHARITABLE FOUNDATION INDA', customer_id: customer.rows[0]?.id || null,
  description: 'Demo project for the combined packing list (safe to delete)', series: 'SF', model_capacity: 50, model_pressure: 10.54, model_design: 'WB',
  company: 'Shanti Boilers',
}).then(r => ({ id: r.id ?? r.project?.id ?? r.projectId }));
let projectId = id;
if (!projectId) projectId = (await run('SELECT id FROM projects WHERE project_no = ?', [TAG])).rows[0].id;
console.log('project', projectId);

const node = async (name, parent = null, type = null, config = null, order = 0) => Number((await run(
  'INSERT INTO bom_assemblies (project_id, parent_id, name, node_type, config_json, sort_order, created_by) VALUES (?,?,?,?,?,?,?)',
  [projectId, parent, name, type, config ? JSON.stringify(config) : null, order, 'demo-seed'])).lastInsertRowid);

let sort = 0;
const item = async (assembly, desc, o = {}) => {
  const mfg = !!o.mfg;
  const r = await run(
    `INSERT INTO bom_items (project_id, material_description, moc, size_spec, make, qty_text, purchase_status, source, pending_review,
       requires_manufacturing, production_done, assembly_id, sort_order, origin)
     VALUES (?,?,?,?,?,?,?,'bom',0,?,?,?,?,'manual')`,
    [projectId, desc, o.moc || 'MS', o.size || null, o.make || null, `${o.qty ?? 1} ${o.unit || 'Nos'}`, mfg ? 'Enquiry' : 'Received',
      mfg ? 1 : 0, mfg ? 1 : 0, assembly, ++sort]);
  const bomId = Number(r.lastInsertRowid);
  await run('INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to, decided_by) VALUES (?,?,?,?)', [bomId, projectId, mfg ? 'production' : 'dispatch', 'demo-seed']);
  if (o.serials) await run('INSERT INTO bom_item_receipts (bom_item_id, qty_received, received_serial_no, received_by) VALUES (?,?,?,?)', [bomId, o.qty ?? 1, o.serials.join(','), 'demo-seed']);
  return bomId;
};

// BOILER
const boiler = await node('Boiler', null, 'System', null, 1);
const shell = await node('Boiler Shell & Body', boiler, 'Subsystem', null, 1);
const feed = await node('Feed Line', boiler, 'Subsystem', null, 2);
const blow = await node('Blow Down Line', boiler, 'Subsystem', null, 3);
const mount = await node('Boiler Mounting & Fittings', boiler, 'Subsystem', null, 4);
const fire = await node('Fire Door & Fire Bars', boiler, 'Subsystem', null, 5);
const panel = await node('Electrical Panel', boiler, 'Subsystem', null, 6);
for (const [d, s, q] of [['SHELL PLATE', '2500 X 1200 X 10 THK', 1], ['FRONT TUBE PLATE', '1200 DIA X 12 THK', 1], ['REAR TUBE PLATE', '1200 DIA X 12 THK', 1], ['FIRE TUBE', '63.5 OD X 3.2 THK', 24]])
  await item(shell, d, { mfg: 1, size: s, qty: q, moc: 'SA 516 GR 70' });
await item(feed, 'FEED LINE PIPE', { mfg: 1, size: '25 NB SCH 40', qty: 3, moc: 'CS' });
await item(feed, 'COUPLING', { size: '1/2"', qty: 3, moc: 'CS', make: '-' });
await item(feed, 'U\' TYPE SYPHONE ASSEMBLY FOR FEED LINE', { size: '15MM', qty: 1, moc: 'CS', make: 'SHANTI' });
await item(blow, 'BLOWDOWN PIPE', { mfg: 1, size: '25 NB SCH 40', qty: 1, moc: 'CS' });
await item(blow, 'BLOW DOWN VALVE- SHELL - F/E', { size: '25MM, BS 10 TABLE-H', qty: 1, moc: 'CS', make: 'UTAM', serials: ['AR-8433'] });
await item(mount, 'SAFETY VALVE', { size: '25 x 25 MM, BS-10 TABLE - \'H\'(10.54Kg)', qty: 2, moc: 'CS', make: 'V-TECH', serials: ['60856', '60857'] });
await item(mount, 'PRESSURE GAUGE (STEAM)', { size: 'D-6", 1/2" BSP 0-21KG/CM2(G)', qty: 1, make: 'TERRA', serials: ['25TD-1662'] });
await item(mount, 'PRESSURE GAUGE (STEAM)', { size: 'D-4", 1/2" BSP 0-21KG/CM2(G)', qty: 1, make: 'TERRA', serials: ['25TK-1063'] });
await item(mount, 'PRESSURE SWITCH', { size: 'UT-10', qty: 1, make: 'DANFUSS' });
await item(mount, 'DISK CHECK VALVE', { size: '25NB', qty: 3, moc: 'SS', make: 'UTAM', serials: ['AY-5684', 'AY-5678', 'AY-5679'] });
await item(mount, 'GLOBE VALVE( MSSV ) - F/E', { size: '40MM, BS-10 TABLE-H', qty: 1, moc: 'CI', make: 'UTAM', serials: ['AY-0190'] });
await item(mount, 'GLOBE VALVE FOR AIR VENT', { size: '15NB, S/E', qty: 1, moc: 'FORGED', make: 'UTAM', serials: ['AV-4664'] });
await item(mount, 'GLOBE VALVE FOR - Pr.Gauge, Pr Switch & Mobery drain.', { size: '15MM', qty: 3, moc: 'FORGED', make: 'UTAM', serials: ['AV-4647', 'AV-4641', 'AV-4645'] });
await item(mount, 'ISO VALVE FOR MOBERY-F/E', { size: '25MM, BS-10 TABLE \'H\'', qty: 2, moc: 'CI', make: 'UTAM', serials: ['AX-9801', 'AX-9802'] });
await item(mount, 'FEED GLOBE VALVE - F/E', { size: '25MM, BS 10 TABLE-H', qty: 3, moc: 'CI', make: 'UTAM', serials: ['AX-9803', 'AX-9804', 'AX-9805'] });
await item(mount, 'FEED PUMP (TYPE-CENTRIFUGAL) & MOTOR', { size: '1 M3/HR,120MWC,1.5HP,2880 RPM', qty: 2, moc: 'SS', make: 'SHAKTI', serials: ['2190551012', '2190551009'] });
for (const [s, q] of [['(40 NB)', 2], ['(25 NB)', 20], ['(20NB)', 6]]) await item(mount, 'METALLIC GASKET FOR NOZZLE', { size: s, qty: q, moc: 'MATALLIC', make: 'SHANTI' });
await item(mount, 'COUPLING', { size: '1/2"', qty: 2, moc: 'CS', make: '-' });
await item(mount, 'HEX NIPPLE', { size: '1/2" X 3/8"', qty: 3, moc: 'CS', make: '-' });
await item(mount, 'PIPE NIPPLE', { size: '1/2"', qty: 3, moc: 'CS', make: '-' });
for (const [s, q] of [['5/8" X 2 1/2"', 100], ['5/8" X 3"', 10], ['5/8" X 4"', 12]]) await item(mount, 'FASTNER', { size: s, qty: q, moc: 'GI', make: 'SHANTI' });
await item(fire, 'TRIPLEX FIRE BAR', { size: '50 H x 100W x 630L', qty: 12, moc: 'CI', make: 'SHANTI' });
await item(fire, 'H\' BAR', { size: '40Ht. X 50W X 680 Lg', qty: 4, moc: 'CI', make: 'SHANTI' });
await item(fire, 'FIRE DOOR (SMALL)', { size: 'STD ( 350X 350)', qty: 1, moc: 'MS', make: 'SHANTI' });
await item(fire, 'FUSIBLE PLUG SINEGLE PEC DESIGN', { size: '25MM(BSPT THREAD)', qty: 1, moc: 'BRONZE', make: 'UTAM' });
await item(panel, 'CONTROL PANNEL', { size: 'AS PER DRAWING', qty: 1, moc: 'MS', make: 'SHANTI' });

// ID FAN (fabricated, one assembly line; motor rating comes from the node's Configuration)
const fan = await node('ID Fan', null, 'System', [{ label: 'MOTOR RATING', value: '3', unit: 'HP' }, { label: 'MODEL', value: '2.20KNE4 CG', unit: '' }], 2);
for (const d of ['FAN CASING', 'IMPELLER', 'FAN BASE FRAME']) await item(fan, d, { mfg: 1, qty: 1 });

// CHIMNEY
const chim = await node('MS Tapered Chimney', null, 'System', null, 3);
await item(chim, 'STRAIGHT CHIMNEY (PIPE)', { mfg: 1, size: 'DIA : 300NB x 5.2MM PIPE (IS3589) 6000Lg', qty: 1 });
await item(chim, 'TOP HOOD', { mfg: 1, size: 'AS PER DRAWING', qty: 1 });
await item(chim, 'MS FASTNERS', { size: '1/2" x 2"', qty: 10, moc: 'MS' });
await item(chim, 'ASBESTOR ROPE', { size: 'DIA 6', qty: 2, unit: 'Mtrs', moc: 'ASBESTOR' });
await item(chim, 'CHIMNEY FOUNDATION (DOUBLE NUT AND BOLT WITH WASHERS)', { size: 'M25 x 900 LG', qty: 6 });
await item(chim, 'CHIMNEY FOUNDATION SINGLE TEMPLATE', { size: 'OD 825 x ID 200 x 3 / 2THK', qty: 1 });

// SDC
const sdc = await node('SDC', null, 'System', null, 4);
await item(sdc, 'SDC', { mfg: 1, size: 'AS PER DRAWING', qty: 1 });
await item(sdc, 'SDC STRUCTURE', { size: 'ISMC 75 x 40 - 1600 Lg.', qty: 3 });

// FLUE GAS DUCT
const duct = await node('Flue Gas Duct', null, 'System', null, 5);
for (const [s, q] of [['300 ROUND', 5], ['350 X 250', 4], ['260 DIA', 1]]) await item(duct, 'FLUE GAS DUCT', { mfg: 1, size: s, qty: q });
await item(duct, 'FLANGES', { size: '300 X 250', qty: 4 });
await item(duct, 'ASBESTOR ROPE', { size: '6 MM', qty: 12, unit: 'Mtrs', moc: 'ASBESTOS' });
await item(duct, 'BOLT & NUTS', { size: 'M12 X 40 MM', qty: 64 });

console.log('seeded', TAG, 'project', projectId, 'bom lines', sort);
