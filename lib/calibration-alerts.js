// lib/calibration-alerts.js — daily: instruments and jigs whose calibration is due within 7 days or
// already expired. One alert per item per status (dedupe), to QC, opening QC → Calibration on it.
import { queryAll } from './db';
import { notifyDepartment } from './notify';
import { todayISO } from './date';
import { tabLink } from './alert-links.mjs';

export async function sweepCalibrationAlerts() {
  const today = todayISO();
  const soon = new Date(today + 'T00:00:00Z'); soon.setUTCDate(soon.getUTCDate() + 7);
  const items = await queryAll(
    'SELECT id, name, identifier, due_date FROM calibration_items WHERE blocked = 0 AND due_date IS NOT NULL AND due_date <= ?',
    [soon.toISOString().slice(0, 10)]);
  let sent = 0;
  for (const it of items) {
    const expired = it.due_date < today;
    sent += await notifyDepartment('QC', {
      kind: 'calibration_due',
      title: `${expired ? 'Calibration expired' : 'Calibration due'} — ${it.name}${it.identifier ? ` (${it.identifier})` : ''}`,
      body: `Due ${it.due_date}`, link: tabLink('/qc', 'calibration', { highlight: `CAL-${it.id}` }),
      dedupe_key: `calibration:${it.id}:${it.due_date}:${expired ? 'expired' : 'due'}`,
    }) || 0;
  }
  return { checked: items.length, sent };
}
