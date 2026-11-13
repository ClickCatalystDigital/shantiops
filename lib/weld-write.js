// Checks and side effects shared by the weld create and edit routes.
import { queryOne } from './db';
import { bumpLastWeld } from './welding.mjs';
import { parseJson, splitList } from './quality';

const t = v => String(v ?? '').trim() || null;

// The request -> clean columns, or { error }. Parts must be BOM lines of the same project; the WPS must exist.
export async function cleanWeld(b, projectId, prev = {}) {
  const pick = k => (k in b ? b[k] : prev[k]);
  const weld_no = t(pick('weld_no'))?.toUpperCase();
  if (!weld_no) return { error: 'Weld number is required' };
  const wps_id = pick('wps_id') ? Number(pick('wps_id')) : null;
  if (wps_id && !(await queryOne('SELECT 1 FROM wps WHERE id = ?', [wps_id]))) return { error: 'WPS not found' };
  for (const k of ['part_a_bom_item_id', 'part_b_bom_item_id']) {
    const v = pick(k);
    if (v && !(await queryOne('SELECT 1 FROM bom_items WHERE id = ? AND project_id = ?', [Number(v), projectId]))) return { error: 'A joined part is not a BOM line of this project' };
  }
  const welded_on = t(pick('welded_on'));
  if (welded_on && !/^\d{4}-\d{2}-\d{2}$/.test(welded_on)) return { error: 'Welded on must be a date' };
  const stamps = splitList(pick('welder_stamps')).map(s => s.toUpperCase());
  for (const s of stamps) if (!(await queryOne('SELECT 1 FROM welders WHERE stamp = ?', [s]))) return { error: `No welder with stamp ${s}` };
  return {
    weld_no, joint: t(pick('joint')), category: t(pick('category')), type: t(pick('type')), wps_id,
    welder_stamps: stamps.join(',') || null, nde: splitList(pick('nde')).map(x => x.toUpperCase()).join(',') || null,
    part_a_bom_item_id: pick('part_a_bom_item_id') ? Number(pick('part_a_bom_item_id')) : null,
    part_b_bom_item_id: pick('part_b_bom_item_id') ? Number(pick('part_b_bom_item_id')) : null, welded_on,
  };
}

// Moves each welder's last-weld date for the WPS process forward (never back), inside the caller's transaction.
export async function applyLastWeld(tx, w) {
  if (!w.welded_on || !w.wps_id || !w.welder_stamps) return;
  const wps = (await tx.execute({ sql: 'SELECT process FROM wps WHERE id = ?', args: [w.wps_id] })).rows[0];
  if (!wps) return;
  for (const stamp of splitList(w.welder_stamps)) {
    const row = (await tx.execute({ sql: 'SELECT id, processes_json FROM welders WHERE stamp = ?', args: [stamp] })).rows[0];
    if (!row) continue;
    const cur = parseJson(row.processes_json, {});
    const next = bumpLastWeld(cur, wps.process, w.welded_on);
    if (next !== cur) await tx.execute({ sql: 'UPDATE welders SET processes_json = ? WHERE id = ?', args: [JSON.stringify(next), row.id] });
  }
}
